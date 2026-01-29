import { Duration, Stack } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WebsocketBrokerProps {
  vpc: IVpc;
  elasticacheEndpoint: string;
  websocketCallbackUrl: string;
  websocketApiId: string;
  websocketMessageQueue: IQueue;
}

export class WebsocketBroker extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebsocketBrokerProps) {
    super(scope, id);

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/websocket-broker/src/index.ts',
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

    const stack = Stack.of(this);
    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${stack.region}:${stack.account}:${props.websocketApiId}/*/@connections/*`,
        ],
      }),
    );

    this.function.addEventSource(
      new SqsEventSource(props.websocketMessageQueue, {
        batchSize: 10,
      }),
    );
  }
}
