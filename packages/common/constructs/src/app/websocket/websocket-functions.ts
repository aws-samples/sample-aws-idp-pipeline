import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WebsocketFunctionsProps {
  vpc: IVpc;
  elasticacheEndpoint: string;
  backendTableName: string;
}

export class WebsocketFunctions extends Construct {
  public readonly connectFunction: NodejsFunction;
  public readonly defaultFunction: NodejsFunction;
  public readonly disconnectFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebsocketFunctionsProps) {
    super(scope, id);

    const { vpc, elasticacheEndpoint, backendTableName } = props;

    const backendTable = Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    this.connectFunction = new NodejsFunction(this, 'ConnectFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/websocket/src/connect.ts',
      ),
      handler: 'connectHandler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(2),
      vpc,
      environment: {
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
        BACKEND_TABLE_NAME: backendTableName,
      },
      bundling: {
        nodeModules: ['iovalkey'],
      },
    });

    backendTable.grantReadData(this.connectFunction);

    this.defaultFunction = new NodejsFunction(this, 'DefaultFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/websocket/src/default.ts',
      ),
      handler: 'defaultHandler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(2),
      vpc,
      environment: {
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
      },
      bundling: {
        nodeModules: ['iovalkey'],
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
      bundling: {
        nodeModules: ['iovalkey'],
      },
    });
  }
}
