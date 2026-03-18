import { Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { SSM_KEYS } from '../../constants/ssm-keys.js';

export class GraphMcp extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const graphServiceFunctionArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.GRAPH_SERVICE_FUNCTION_ARN,
    );

    const lancedbFunctionArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCE_SERVICE_FUNCTION_ARN,
    );

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/graph-mcp/src/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(60),
      environment: {
        GRAPH_SERVICE_FUNCTION_ARN: graphServiceFunctionArn,
        LANCEDB_FUNCTION_ARN: lancedbFunctionArn,
      },
    });

    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [graphServiceFunctionArn, lancedbFunctionArn],
      }),
    );

    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );
  }
}
