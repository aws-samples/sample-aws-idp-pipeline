import { Lazy, Names, Stack, StackProps } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import { execSync } from 'child_process';
import * as path from 'path';
import {
  AgentRuntimeArtifact,
  ProtocolType,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';

/**
 * Docker 이미지 해시를 가져오는 함수
 * CI 환경에서 Docker가 없으면 빈 문자열 반환
 */
function getDockerImageHash(): string {
  try {
    return execSync(
      `docker inspect idp-v2-idp-agent:latest --format '{{.Id}}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return '';
  }
}

export class AgentStack extends Stack {
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const extraHash = getDockerImageHash();

    // process.cwd()는 항상 프로젝트 루트를 가리킴 (CI/로컬 모두)
    const dockerImage = AgentRuntimeArtifact.fromAsset(
      path.join(
        process.cwd(),
        'packages/agents/idp-agent/idp_agent/idp_v2_idp_agent/idp_agent',
      ),
      {
        platform: Platform.LINUX_ARM64,
        ...(extraHash && { extraHash }),
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
