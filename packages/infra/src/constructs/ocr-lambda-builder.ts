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
  Source,
} from 'aws-cdk-lib/aws-codebuild';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Runtime, Function, Code } from 'aws-cdk-lib/aws-lambda';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';

export interface OcrLambdaBuilderProps {
  /**
   * Path to functions/ directory (build context)
   */
  buildContextPath: string;
  /**
   * Path to Dockerfile relative to build context
   * @default 'preprocessing/ocr-lambda-processor/Dockerfile'
   */
  dockerfilePath?: string;
  /**
   * Path to build-trigger Lambda code (reuse existing)
   */
  triggerLambdaPath: string;
  /**
   * ECR repository name
   * @default 'paddleocr-lambda'
   */
  repositoryName?: string;
}

export class OcrLambdaBuilder extends Construct {
  public readonly repository: Repository;
  public readonly imageUri: string;
  public readonly buildTrigger: CustomResource;

  constructor(scope: Construct, id: string, props: OcrLambdaBuilderProps) {
    super(scope, id);

    const repositoryName = props.repositoryName ?? 'paddleocr-lambda';
    const dockerfilePath =
      props.dockerfilePath ?? 'preprocessing/ocr-lambda-processor/Dockerfile';
    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // ECR Repository
    this.repository = new Repository(this, 'Repository', {
      repositoryName,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    this.imageUri = `${this.repository.repositoryUri}:latest`;

    // S3 Asset for build context (functions/ directory)
    const buildContextAsset = new Asset(this, 'BuildContextAsset', {
      path: props.buildContextPath,
    });

    // CodeBuild Project (x86, for PaddlePaddle compatibility)
    const codeBuildProject = new Project(this, 'CodeBuildProject', {
      projectName: 'paddleocr-lambda-builder',
      description: 'Builds PaddleOCR Lambda Docker image (x86)',
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
        computeType: ComputeType.LARGE,
        privileged: true,
      },
      source: Source.s3({
        bucket: buildContextAsset.bucket,
        path: buildContextAsset.s3ObjectKey,
      }),
      cache: Cache.local(LocalCacheMode.DOCKER_LAYER),
      timeout: Duration.minutes(30),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${account}.dkr.ecr.${region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              `docker build -t ${repositoryName}:latest -f ${dockerfilePath} .`,
            ],
          },
          post_build: {
            commands: [
              `docker tag ${repositoryName}:latest ${this.repository.repositoryUri}:latest`,
              `docker push ${this.repository.repositoryUri}:latest`,
            ],
          },
        },
      }),
    });

    // Grant ECR push and S3 read permissions
    this.repository.grantPullPush(codeBuildProject);
    buildContextAsset.grantRead(codeBuildProject);

    codeBuildProject.addToRolePolicy(
      new PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    // Async Custom Resource (reuse model-builder-trigger pattern)
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
      resources: [codeBuildProject.projectArn],
    });
    onEventHandler.addToRolePolicy(codeBuildPolicy);
    isCompleteHandler.addToRolePolicy(codeBuildPolicy);

    const buildProvider = new Provider(this, 'BuildProvider', {
      onEventHandler,
      isCompleteHandler,
      queryInterval: Duration.seconds(30),
      totalTimeout: Duration.minutes(30),
    });

    this.buildTrigger = new CustomResource(this, 'BuildTrigger', {
      serviceToken: buildProvider.serviceToken,
      properties: {
        ProjectName: codeBuildProject.projectName,
        ContentHash: buildContextAsset.assetHash,
      },
    });
    this.buildTrigger.node.addDependency(this.repository);
    this.buildTrigger.node.addDependency(codeBuildProject);

    // Outputs
    new CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR Repository URI for PaddleOCR Lambda',
    });

    new CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'Docker Image URI for OCR Lambda',
    });
  }
}
