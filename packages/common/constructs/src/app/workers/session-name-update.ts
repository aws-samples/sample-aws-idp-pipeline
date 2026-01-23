import { Duration, Stack } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { S3EventSourceV2 } from 'aws-cdk-lib/aws-lambda-event-sources';
import { IBucket, EventType } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface SessionNameUpdateProps {
  bucket: IBucket;
  vpc: IVpc;
  elasticacheEndpoint: string;
}

export class SessionNameUpdate extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: SessionNameUpdateProps) {
    super(scope, id);

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/session_name_update/src/index.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      vpc: props.vpc,
      environment: {
        ELASTICACHE_ENDPOINT: props.elasticacheEndpoint,
      },
      bundling: {
        nodeModules: ['ioredis'],
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

    this.function.addEventSource(
      new S3EventSourceV2(props.bucket, {
        events: [EventType.OBJECT_CREATED],
        filters: [{ prefix: 'sessions/', suffix: 'message_1.json' }],
      }),
    );
  }
}
