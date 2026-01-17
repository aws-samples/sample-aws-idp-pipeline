import {
  RemovalPolicy,
  Stack,
  CfnOutput,
  Duration,
  CustomResource,
} from 'aws-cdk-lib';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import {
  Project,
  BuildSpec,
  LinuxBuildImage,
  ComputeType,
  Cache,
  LocalCacheMode,
} from 'aws-cdk-lib/aws-codebuild';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Runtime, Function, Code } from 'aws-cdk-lib/aws-lambda';
import * as crypto from 'crypto';
import * as fs from 'fs';

export interface PaddleOcrModelBuilderProps {
  /**
   * S3 bucket to store model artifacts
   */
  bucket: Bucket;
  /**
   * Path to the build-trigger Lambda code
   */
  triggerLambdaPath: string;
  /**
   * Path to the model-uploader Lambda code
   */
  modelUploaderLambdaPath: string;
  /**
   * Path to the inference.py code
   */
  inferenceCodePath: string;
  /**
   * Name of the ECR repository for Docker image
   * @default 'paddleocr-sagemaker'
   */
  repositoryName?: string;
}

// Dockerfile content for PaddleOCR SageMaker
const DOCKERFILE_CONTENT = `# PaddleOCR Docker Image for AWS SageMaker
FROM 763104351884.dkr.ecr.us-east-1.amazonaws.com/pytorch-inference:2.2.0-gpu-py310-cu118-ubuntu20.04-sagemaker

WORKDIR /opt/ml/code
ENV PADDLEOCR_HOME=/tmp/.paddleocr
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    libgl1-mesa-glx \\
    libglib2.0-0 \\
    libsm6 \\
    libxext6 \\
    libxrender-dev \\
    && rm -rf /var/lib/apt/lists/*

# Install PaddlePaddle GPU (CUDA 11.8)
RUN pip install --upgrade pip && \\
    pip install paddlepaddle-gpu==3.2.2 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/

# Install PaddleOCR with all extras
RUN pip install "paddleocr[all]" "paddlex[ocr]"

EXPOSE 8080`;

export class PaddleOcrModelBuilder extends Construct {
  public readonly repository: Repository;
  public readonly imageUri: string;
  public readonly modelDataUrl: string;
  public readonly dockerBuildTrigger: CustomResource;
  public readonly modelUploadTrigger: CustomResource;

  constructor(scope: Construct, id: string, props: PaddleOcrModelBuilderProps) {
    super(scope, id);

    const repositoryName = props.repositoryName || 'paddleocr-sagemaker';
    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // Read inference.py content
    const inferenceCode = fs.readFileSync(props.inferenceCodePath, 'utf-8');

    // Calculate hashes for change detection
    const dockerHash = crypto
      .createHash('md5')
      .update(DOCKERFILE_CONTENT)
      .digest('hex')
      .substring(0, 8);

    const inferenceHash = crypto
      .createHash('md5')
      .update(inferenceCode)
      .digest('hex')
      .substring(0, 8);

    // ECR Repository for Docker image
    this.repository = new Repository(this, 'Repository', {
      repositoryName,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    this.imageUri = `${this.repository.repositoryUri}:latest`;
    this.modelDataUrl = `s3://${props.bucket.bucketName}/paddleocr/model.tar.gz`;

    // ========================================
    // CodeBuild: Docker Image Only
    // ========================================
    const dockerBuildProject = new Project(this, 'DockerBuildProject', {
      projectName: 'paddleocr-docker-builder',
      description: 'Builds PaddleOCR Docker image for SageMaker',
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
        computeType: ComputeType.LARGE,
        privileged: true,
      },
      cache: Cache.local(LocalCacheMode.DOCKER_LAYER),
      timeout: Duration.minutes(30),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${account}.dkr.ecr.${region}.amazonaws.com`,
              'echo Logging in to SageMaker ECR for base image...',
              `aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 763104351884.dkr.ecr.us-east-1.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              'echo Building Docker image...',
              `cat > Dockerfile << 'DOCKERFILE_EOF'
${DOCKERFILE_CONTENT}
DOCKERFILE_EOF`,
              'cat Dockerfile',
              `docker build -t ${repositoryName}:latest .`,
            ],
          },
          post_build: {
            commands: [
              'echo Pushing Docker image to ECR...',
              `docker tag ${repositoryName}:latest ${this.repository.repositoryUri}:latest`,
              `docker push ${this.repository.repositoryUri}:latest`,
              'echo Docker build completed!',
            ],
          },
        },
      }),
    });

    // Grant ECR permissions
    this.repository.grantPullPush(dockerBuildProject);

    // Grant access to SageMaker base image ECR
    dockerBuildProject.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        resources: ['*'],
      }),
    );

    // ========================================
    // Lambda: Docker Build Trigger (async pattern)
    // ========================================
    const onEventHandler = new Function(this, 'OnEventHandler', {
      runtime: Runtime.PYTHON_3_14,
      handler: 'index.on_event',
      timeout: Duration.minutes(1),
      code: Code.fromAsset(props.triggerLambdaPath),
    });

    const isCompleteHandler = new Function(this, 'IsCompleteHandler', {
      runtime: Runtime.PYTHON_3_14,
      handler: 'index.is_complete',
      timeout: Duration.minutes(1),
      code: Code.fromAsset(props.triggerLambdaPath),
    });

    const codeBuildPolicy = new PolicyStatement({
      actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
      resources: [dockerBuildProject.projectArn],
    });
    onEventHandler.addToRolePolicy(codeBuildPolicy);
    isCompleteHandler.addToRolePolicy(codeBuildPolicy);

    const dockerBuildProvider = new Provider(this, 'DockerBuildProvider', {
      onEventHandler,
      isCompleteHandler,
      queryInterval: Duration.seconds(30),
      totalTimeout: Duration.minutes(30),
    });

    this.dockerBuildTrigger = new CustomResource(this, 'DockerBuildTrigger', {
      serviceToken: dockerBuildProvider.serviceToken,
      properties: {
        ProjectName: dockerBuildProject.projectName,
        ContentHash: dockerHash,
      },
    });
    this.dockerBuildTrigger.node.addDependency(this.repository);
    this.dockerBuildTrigger.node.addDependency(dockerBuildProject);

    // ========================================
    // Lambda: Model Uploader (creates model.tar.gz)
    // ========================================
    const modelUploaderLambda = new Function(this, 'ModelUploaderLambda', {
      runtime: Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      code: Code.fromAsset(props.modelUploaderLambdaPath),
    });

    props.bucket.grantWrite(modelUploaderLambda);

    const modelUploaderProvider = new Provider(this, 'ModelUploaderProvider', {
      onEventHandler: modelUploaderLambda,
    });

    this.modelUploadTrigger = new CustomResource(this, 'ModelUploadTrigger', {
      serviceToken: modelUploaderProvider.serviceToken,
      properties: {
        BucketName: props.bucket.bucketName,
        InferenceCode: inferenceCode,
        OutputKey: 'paddleocr/model.tar.gz',
        CodeHash: inferenceHash,
      },
    });

    // Outputs
    new CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR Repository URI for PaddleOCR',
    });

    new CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'Docker Image URI for SageMaker',
    });

    new CfnOutput(this, 'ModelDataUrl', {
      value: this.modelDataUrl,
      description: 'S3 URL for model.tar.gz',
    });
  }
}
