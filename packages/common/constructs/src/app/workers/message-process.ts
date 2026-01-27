import { Duration, Stack } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { S3EventSourceV2 } from 'aws-cdk-lib/aws-lambda-event-sources';
import { IBucket, EventType } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MessageProcessProps {
  bucket: IBucket;
  vpc: IVpc;
  elasticacheEndpoint: string;
  websocketCallbackUrl: string;
  websocketApiId: string;
}

export class MessageProcess extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: MessageProcessProps) {
    super(scope, id);

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/session_workers/src/message_process/index.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      vpc: props.vpc,
      environment: {
        ELASTICACHE_ENDPOINT: props.elasticacheEndpoint,
        WEBSOCKET_CALLBACK_URL: props.websocketCallbackUrl,
      },
      bundling: {
        nodeModules: ['iovalkey'],
      },
    });

    props.bucket.grantReadWrite(this.function);

    const stack = Stack.of(this);
    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${stack.account}:inference-profile/*`,
        ],
      }),
    );

    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${stack.region}:${stack.account}:${props.websocketApiId}/*/@connections/*`,
        ],
      }),
    );

    this.function.addEventSource(
      new S3EventSourceV2(props.bucket, {
        events: [EventType.OBJECT_CREATED],
        filters: [{ prefix: 'sessions/', suffix: '.json' }],
      }),
    );
  }
}
