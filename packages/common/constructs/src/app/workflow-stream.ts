import { Duration, Stack } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Runtime,
  Architecture,
  StartingPosition,
  FilterCriteria,
  FilterRule,
} from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WorkflowStreamProps {
  backendTable: ITable;
  vpc: IVpc;
  elasticacheEndpoint: string;
  websocketCallbackUrl: string;
  websocketApiId: string;
}

export class WorkflowStream extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: WorkflowStreamProps) {
    super(scope, id);

    const {
      backendTable,
      vpc,
      elasticacheEndpoint,
      websocketCallbackUrl,
      websocketApiId,
    } = props;
    const stack = Stack.of(this);

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/workflow-stream/src/index.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      vpc,
      environment: {
        BACKEND_TABLE_NAME: backendTable.tableName,
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
        WEBSOCKET_CALLBACK_URL: websocketCallbackUrl,
      },
      bundling: {
        nodeModules: ['iovalkey'],
      },
    });

    // Grant permissions
    backendTable.grantReadData(this.function);
    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${stack.region}:${stack.account}:${websocketApiId}/*/@connections/*`,
        ],
      }),
    );

    // Add DynamoDB Stream event source with filters
    // Filter 1: DOC#/WF# records (workflow status changes)
    // Filter 2: WF#/STEP records (step progress changes)
    this.function.addEventSource(
      new DynamoEventSource(backendTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
        filters: [
          FilterCriteria.filter({
            dynamodb: {
              Keys: {
                PK: { S: FilterRule.beginsWith('DOC#') },
                SK: { S: FilterRule.beginsWith('WF#') },
              },
            },
          }),
          FilterCriteria.filter({
            dynamodb: {
              Keys: {
                PK: { S: FilterRule.beginsWith('WF#') },
                SK: { S: FilterRule.isEqual('STEP') },
              },
            },
          }),
        ],
      }),
    );
  }
}
