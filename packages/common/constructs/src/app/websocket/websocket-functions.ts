import { Duration } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WebsocketFunctionsProps {
  vpc: IVpc;
  elasticacheEndpoint: string;
}

export class WebsocketFunctions extends Construct {
  public readonly connectFunction: NodejsFunction;
  public readonly defaultFunction: NodejsFunction;
  public readonly disconnectFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebsocketFunctionsProps) {
    super(scope, id);

    const { vpc, elasticacheEndpoint } = props;

    this.connectFunction = new NodejsFunction(this, 'ConnectFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/websocket/src/connect.ts',
      ),
      handler: 'connectHandler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(10),
      vpc,
      environment: {
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
      },
    });

    this.defaultFunction = new NodejsFunction(this, 'DefaultFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/websocket/src/default.ts',
      ),
      handler: 'defaultHandler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(10),
      vpc,
      environment: {
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
      },
    });

    this.disconnectFunction = new NodejsFunction(this, 'DisconnectFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/websocket/src/disconnect.ts',
      ),
      handler: 'disconnectHandler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(10),
      vpc,
      environment: {
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
      },
    });
  }
}
