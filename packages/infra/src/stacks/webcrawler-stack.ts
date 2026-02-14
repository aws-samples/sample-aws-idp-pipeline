import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { SSM_KEYS } from ':idp-v2/common-constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * WebcrawlerStack - WebCrawler Consumer Lambda
 *
 * Consumes webcrawler queue messages and invokes AgentCore runtime.
 */
export class WebcrawlerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========================================
    // Lookup Existing Resources (from SSM)
    // ========================================

    const backendTableName = ssm.StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = dynamodb.Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    const webcrawlerQueueArn = ssm.StringParameter.valueForStringParameter(
      this,
      '/idp-v2/preprocess/webcrawler/queue-arn',
    );
    const webcrawlerQueue = sqs.Queue.fromQueueArn(
      this,
      'WebcrawlerQueue',
      webcrawlerQueueArn,
    );

    const webcrawlerAgentRuntimeArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        SSM_KEYS.WEBCRAWLER_AGENT_RUNTIME_ARN,
      );

    // ========================================
    // Shared Code Layer
    // ========================================

    const sharedLayer = new lambda.LayerVersion(this, 'SharedCodeLayer', {
      layerVersionName: 'idp-v2-webcrawler-shared',
      description: 'Shared Python modules for webcrawler processing',
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
    // WebCrawler Consumer Lambda
    // ========================================

    const webcrawlerConsumer = new lambda.Function(this, 'WebcrawlerConsumer', {
      functionName: 'idp-v2-webcrawler-consumer',
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../functions/preprocessing/webcrawler-consumer'),
      ),
      layers: [sharedLayer],
      environment: {
        BACKEND_TABLE_NAME: backendTableName,
        WEBCRAWLER_AGENT_RUNTIME_ARN: webcrawlerAgentRuntimeArn,
      },
    });

    backendTable.grantReadWriteData(webcrawlerConsumer);

    webcrawlerConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/webcrawler_agent*`,
        ],
      }),
    );

    webcrawlerConsumer.addEventSource(
      new lambdaEventSources.SqsEventSource(webcrawlerQueue, {
        batchSize: 1,
      }),
    );
  }
}
