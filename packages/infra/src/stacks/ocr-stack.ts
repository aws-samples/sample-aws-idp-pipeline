import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { SSM_KEYS } from ':idp-v2/common-constructs';
import {
  PaddleOcrModelBuilder,
  PaddleOcrEndpoint,
} from '../constructs/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * OcrStack - OCR Processing via SageMaker Endpoint
 *
 * Processes PDF/Image documents using PaddleOCR on SageMaker with auto-scaling (0-1).
 */
export class OcrStack extends Stack {
  public readonly endpointName: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // Lookup Existing Resources (from SSM)
    // ========================================

    const documentBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    const documentBucket = s3.Bucket.fromBucketName(
      this,
      'DocumentBucket',
      documentBucketName,
    );

    const modelArtifactsBucketName =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.MODEL_ARTIFACTS_BUCKET_NAME,
      );
    const modelArtifactsBucket = s3.Bucket.fromBucketName(
      this,
      'ModelArtifactsBucket',
      modelArtifactsBucketName,
    );

    const backendTableName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = dynamodb.Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    const ocrQueueArn = ssm.StringParameter.valueForStringParameter(
      this,
      '/idp-v2/preprocess/ocr/queue-arn',
    );
    const ocrQueue = sqs.Queue.fromQueueArn(this, 'OcrQueue', ocrQueueArn);

    // ========================================
    // PaddleOCR Model Builder (CodeBuild + ECR)
    // ========================================

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

    // ========================================
    // SNS Topics for Async Inference Notifications
    // ========================================

    const ocrSuccessTopic = new sns.Topic(this, 'OcrSuccessTopic', {
      topicName: 'idp-v2-ocr-success',
    });

    const ocrErrorTopic = new sns.Topic(this, 'OcrErrorTopic', {
      topicName: 'idp-v2-ocr-error',
    });

    // ========================================
    // PaddleOCR SageMaker Endpoint with Auto Scaling (0-1)
    // ========================================

    const paddleOcrEndpoint = new PaddleOcrEndpoint(this, 'PaddleOcrEndpoint', {
      bucket: modelArtifactsBucket as s3.Bucket,
      documentBucket: documentBucket as s3.Bucket,
      imageUri: paddleOcrModelBuilder.imageUri,
      modelDataUrl: paddleOcrModelBuilder.modelDataUrl,
      buildTrigger: paddleOcrModelBuilder.dockerBuildTrigger,
      instanceType: 'ml.g5.xlarge', // A10G 24GB GPU
      minCapacity: 0, // Scale to zero when idle
      maxCapacity: 1,
      successTopic: ocrSuccessTopic,
      errorTopic: ocrErrorTopic,
    });

    this.endpointName = paddleOcrEndpoint.endpointName;

    // Store endpoint name in SSM
    new ssm.StringParameter(this, 'PaddleOcrEndpointNameParam', {
      parameterName: SSM_KEYS.PADDLEOCR_ENDPOINT_NAME,
      stringValue: this.endpointName,
    });

    // ========================================
    // Shared Code Layer
    // ========================================

    const sharedLayer = new lambda.LayerVersion(this, 'SharedCodeLayer', {
      layerVersionName: 'idp-v2-ocr-shared',
      description: 'Shared Python modules for OCR',
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_14],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      code: lambda.Code.fromAsset(path.join(__dirname, '../functions'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_14.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir: string): boolean {
              const pythonDir = path.join(outputDir, 'python');
              const sharedSrc = path.join(__dirname, '../functions/shared');
              const sharedDst = path.join(pythonDir, 'shared');
              fs.mkdirSync(sharedDst, { recursive: true });
              fs.cpSync(sharedSrc, sharedDst, { recursive: true });
              return true;
            },
          },
        },
      }),
    });

    // ========================================
    // OCR Invoker Lambda (just invoke, no polling)
    // ========================================

    const ocrInvoker = new lambda.Function(this, 'OcrInvoker', {
      functionName: 'idp-v2-ocr-invoker',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/ocr-invoker'),
      ),
      layers: [sharedLayer],
      environment: {
        BACKEND_TABLE_NAME: backendTableName,
        OUTPUT_BUCKET: documentBucketName,
        SAGEMAKER_ENDPOINT_NAME: this.endpointName,
      },
    });

    // Grant permissions
    backendTable.grantReadWriteData(ocrInvoker);
    documentBucket.grantRead(ocrInvoker);
    documentBucket.grantPut(ocrInvoker);

    // SageMaker permissions (for async inference and scale-out)
    ocrInvoker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sagemaker:InvokeEndpointAsync'],
        resources: ['*'],
      }),
    );
    ocrInvoker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sagemaker:UpdateEndpointWeightsAndCapacities'],
        resources: [`arn:aws:sagemaker:${this.region}:${this.account}:endpoint/${this.endpointName}`],
      }),
    );

    // SQS Event Source
    ocrInvoker.addEventSource(
      new lambdaEventSources.SqsEventSource(ocrQueue, {
        batchSize: 1,
      }),
    );

    // ========================================
    // OCR Complete Handler Lambda (SNS triggered)
    // ========================================

    const ocrCompleteHandler = new lambda.Function(this, 'OcrCompleteHandler', {
      functionName: 'idp-v2-ocr-complete-handler',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/ocr-complete-handler'),
      ),
      layers: [sharedLayer],
      environment: {
        BACKEND_TABLE_NAME: backendTableName,
        OUTPUT_BUCKET: documentBucketName,
      },
    });

    // Grant permissions
    backendTable.grantReadWriteData(ocrCompleteHandler);
    documentBucket.grantRead(ocrCompleteHandler);
    documentBucket.grantPut(ocrCompleteHandler);
    modelArtifactsBucket.grantRead(ocrCompleteHandler);

    // Subscribe to SNS topics
    ocrSuccessTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(ocrCompleteHandler),
    );
    ocrErrorTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(ocrCompleteHandler),
    );

    // ========================================
    // Fallback Scale-In (10 min alarm)
    // ========================================

    // CloudWatch alarm: backlog = 0 for 10 consecutive minutes
    const scaleInAlarm = new cloudwatch.Alarm(this, 'ScaleInAlarm', {
      alarmName: 'idp-v2-paddleocr-scale-in',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SageMaker',
        metricName: 'ApproximateBacklogSizePerInstance',
        dimensionsMap: {
          EndpointName: this.endpointName,
        },
        statistic: 'Average',
        period: Duration.minutes(1),
      }),
      threshold: 0.1,
      evaluationPeriods: 10,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    // Lambda to force scale-in (triggered by alarm)
    const scaleInHandler = new lambda.Function(this, 'ScaleInHandler', {
      functionName: 'idp-v2-ocr-scale-in',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      memorySize: 128,
      code: lambda.Code.fromInline(`
import boto3
import os

def handler(event, context):
    endpoint_name = os.environ['SAGEMAKER_ENDPOINT_NAME']
    client = boto3.client('sagemaker')

    # Check current instance count
    response = client.describe_endpoint(EndpointName=endpoint_name)
    current_count = response['ProductionVariants'][0]['CurrentInstanceCount']

    if current_count == 0:
        print(f'Endpoint {endpoint_name} already at 0 instances')
        return {'scaled': False, 'reason': 'already_zero'}

    # Scale to 0
    client.update_endpoint_weights_and_capacities(
        EndpointName=endpoint_name,
        DesiredWeightsAndCapacities=[{
            'VariantName': 'AllTraffic',
            'DesiredInstanceCount': 0
        }]
    )
    print(f'Scaled {endpoint_name} to 0 instances (fallback)')
    return {'scaled': True}
`),
      environment: {
        SAGEMAKER_ENDPOINT_NAME: this.endpointName,
      },
    });

    // Grant SageMaker permissions
    scaleInHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'sagemaker:DescribeEndpoint',
          'sagemaker:UpdateEndpointWeightsAndCapacities',
        ],
        resources: [
          `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/${this.endpointName}`,
        ],
      }),
    );

    // Connect alarm to Lambda via SNS
    const scaleInTopic = new sns.Topic(this, 'ScaleInTopic', {
      topicName: 'idp-v2-ocr-scale-in',
    });
    scaleInTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(scaleInHandler),
    );
    scaleInAlarm.addAlarmAction(new cloudwatchActions.SnsAction(scaleInTopic));
  }
}
