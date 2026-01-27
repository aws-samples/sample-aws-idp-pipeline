import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { SSM_KEYS } from ':idp-v2/common-constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * BdaStack - Bedrock Document Analysis Consumer
 *
 * Processes documents using AWS Bedrock Data Automation.
 */
export class BdaStack extends Stack {
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

    const backendTableName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = dynamodb.Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    const bdaQueueArn = ssm.StringParameter.valueForStringParameter(
      this,
      '/idp-v2/preprocess/bda/queue-arn',
    );
    const bdaQueue = sqs.Queue.fromQueueArn(this, 'BdaQueue', bdaQueueArn);

    // ========================================
    // Shared Code Layer
    // ========================================

    const sharedLayer = new lambda.LayerVersion(this, 'SharedCodeLayer', {
      layerVersionName: 'idp-v2-bda-shared',
      description: 'Shared Python modules for BDA',
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
    // BDA Consumer Lambda
    // ========================================

    const bdaConsumer = new lambda.Function(this, 'BdaConsumer', {
      functionName: 'idp-v2-bda-consumer',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/bda-consumer'),
      ),
      layers: [sharedLayer],
      environment: {
        BACKEND_TABLE_NAME: backendTableName,
        BDA_OUTPUT_BUCKET: documentBucketName,
      },
    });

    // Grant permissions
    backendTable.grantReadWriteData(bdaConsumer);
    documentBucket.grantRead(bdaConsumer);
    documentBucket.grantPut(bdaConsumer);

    // BDA permissions
    bdaConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeDataAutomationAsync',
          'bedrock:GetDataAutomationStatus',
          'bedrock:ListDataAutomationProjects',
          'bedrock:CreateDataAutomationProject',
        ],
        resources: ['*'],
      }),
    );

    bdaConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sts:GetCallerIdentity'],
        resources: ['*'],
      }),
    );

    // SQS Event Source
    bdaConsumer.addEventSource(
      new lambdaEventSources.SqsEventSource(bdaQueue, {
        batchSize: 1,
      }),
    );
  }
}
