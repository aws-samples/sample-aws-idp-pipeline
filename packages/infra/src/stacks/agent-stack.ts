import { Lazy, Names, Stack, StackProps } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import { execSync } from 'child_process';
import * as path from 'path';
import * as url from 'url';
import {
  AgentRuntimeArtifact,
  ProtocolType,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';

export class AgentStack extends Stack {
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dockerImage = AgentRuntimeArtifact.fromAsset(
      path.resolve(
        path.dirname(url.fileURLToPath(import.meta.url)),
        '../../../../agents/idp-agent/idp_agent/idp_v2_idp_agent/idp_agent',
      ),
      {
        platform: Platform.LINUX_ARM64,
        extraHash: execSync(
          `docker inspect idp-v2-idp-agent:latest --format '{{.Id}}'`,
          { encoding: 'utf-8' },
        ).trim(),
      },
    );

    this.agentCoreRuntime = new Runtime(this, 'IdpAgentRuntime', {
      runtimeName: Lazy.string({
        produce: () =>
          Names.uniqueResourceName(this.agentCoreRuntime, { maxLength: 40 }),
      }),
      protocolConfiguration: ProtocolType.HTTP,
      agentRuntimeArtifact: dockerImage,
    });
  }
}
