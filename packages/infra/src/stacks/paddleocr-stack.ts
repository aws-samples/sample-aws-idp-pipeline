import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SSM_KEYS } from ':idp-v2/common-constructs';
import {
  PaddleOcrModelBuilder,
  PaddleOcrEndpoint,
} from '../constructs/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PaddleOcrStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get model artifacts bucket from SSM
    const modelArtifactsBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.MODEL_ARTIFACTS_BUCKET_NAME,
    );

    const modelArtifactsBucket = s3.Bucket.fromBucketName(
      this,
      'ModelArtifactsBucket',
      modelArtifactsBucketName,
    );

    // Get document storage bucket from SSM
    const documentBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );

    const documentBucket = s3.Bucket.fromBucketName(
      this,
      'DocumentBucket',
      documentBucketName,
    );

    // PaddleOCR Model Builder (CodeBuild + ECR)
    const paddleOcrModelBuilder = new PaddleOcrModelBuilder(
      this,
      'PaddleOcrModelBuilder',
      {
        bucket: modelArtifactsBucket as s3.Bucket,
        triggerLambdaPath: path.join(
          __dirname,
          '../functions/paddleocr/model-builder-trigger',
        ),
        modelUploaderLambdaPath: path.join(
          __dirname,
          '../functions/paddleocr/model-uploader',
        ),
        inferenceCodePath: path.join(
          __dirname,
          '../functions/paddleocr/code/inference.py',
        ),
      },
    );

    // PaddleOCR SageMaker Endpoint
    const paddleOcrEndpoint = new PaddleOcrEndpoint(this, 'PaddleOcrEndpoint', {
      bucket: modelArtifactsBucket as s3.Bucket,
      documentBucket: documentBucket as s3.Bucket,
      imageUri: paddleOcrModelBuilder.imageUri,
      modelDataUrl: paddleOcrModelBuilder.modelDataUrl,
      buildTrigger: paddleOcrModelBuilder.dockerBuildTrigger,
    });

    // Store endpoint name in SSM for WorkflowStack to reference
    new StringParameter(this, 'PaddleOcrEndpointNameParam', {
      parameterName: SSM_KEYS.PADDLEOCR_ENDPOINT_NAME,
      stringValue: paddleOcrEndpoint.endpointName,
    });
  }
}
