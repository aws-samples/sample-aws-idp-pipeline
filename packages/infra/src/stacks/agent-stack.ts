import { Stack, StackProps } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import {
  AgentRuntimeArtifact,
  ProtocolType,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { SSM_KEYS } from ':idp-v2/common-constructs';

export class AgentStack extends Stack {
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get session storage bucket name from SSM
    const sessionStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.SESSION_STORAGE_BUCKET_NAME,
    );

    const sessionStorageBucket = Bucket.fromBucketName(
      this,
      'SessionStorageBucket',
      sessionStorageBucketName,
    );

    const dockerImage = AgentRuntimeArtifact.fromAsset(
      path.resolve(process.cwd(), '../../packages/agents/idp-agent'),
      { platform: Platform.LINUX_ARM64 },
    );

    this.agentCoreRuntime = new Runtime(this, 'IdpAgentRuntime', {
      runtimeName: 'idp_agent_runtime',
      protocolConfiguration: ProtocolType.HTTP,
      agentRuntimeArtifact: dockerImage,
      environmentVariables: {
        SESSION_STORAGE_BUCKET_NAME: sessionStorageBucketName,
      },
    });

    // Grant S3 read/write access for session storage
    sessionStorageBucket.grantReadWrite(this.agentCoreRuntime.role);

    // Add Bedrock model invocation permissions
    this.agentCoreRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      }),
    );

    // Store Agent Runtime ARN in SSM for cross-stack reference
    new StringParameter(this, 'AgentRuntimeArnParam', {
      parameterName: SSM_KEYS.AGENT_RUNTIME_ARN,
      stringValue: this.agentCoreRuntime.agentRuntimeArn,
      description: 'ARN of the IDP Agent Runtime',
    });
  }
}
