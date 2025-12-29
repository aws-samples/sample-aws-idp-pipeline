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

/**
 * Docker 이미지 해시를 가져오는 함수
 * CI 환경에서 Docker가 없으면 타임스탬프를 사용
 */
function getDockerImageHash(): string {
  try {
    return execSync(
      `docker inspect idp-v2-idp-agent:latest --format '{{.Id}}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    // Docker가 없는 CI 환경에서는 소스 디렉토리의 변경을 기반으로 함
    // CDK가 자체적으로 파일 해시를 계산하므로 빈 문자열 반환
    return '';
  }
}

export class AgentStack extends Stack {
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const extraHash = getDockerImageHash();

    const dockerImage = AgentRuntimeArtifact.fromAsset(
      path.resolve(
        path.dirname(url.fileURLToPath(import.meta.url)),
        '../../../../agents/idp-agent/idp_agent/idp_v2_idp_agent/idp_agent',
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
