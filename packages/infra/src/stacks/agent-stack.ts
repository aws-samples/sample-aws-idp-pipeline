import { Stack, StackProps } from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import {
  CodeInterpreterCustom,
  Gateway,
  Runtime,
} from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { IdpAgent, SSM_KEYS } from ':idp-v2/common-constructs';

export interface AgentStackProps extends StackProps {
  gateway: Gateway;
}

export class AgentStack extends Stack {
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const { gateway } = props;

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

    // Get backend table from SSM
    const backendTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );

    const backendTable = Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    // Get agent storage bucket from SSM
    const agentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.AGENT_STORAGE_BUCKET_NAME,
    );

    const agentStorageBucket = Bucket.fromBucketName(
      this,
      'AgentStorageBucket',
      agentStorageBucketName,
    );

    // Get websocket message queue from SSM
    const websocketMessageQueueArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.WEBSOCKET_MESSAGE_QUEUE_ARN,
    );
    const websocketMessageQueue = Queue.fromQueueArn(
      this,
      'WebsocketMessageQueue',
      websocketMessageQueueArn,
    );

    // Initialize prompt files in S3 on first deployment
    const promptSeeds: { id: string; localPath: string; s3Key: string }[] = [
      {
        id: 'InitChatSystemPrompt',
        localPath: 'src/prompts/chat/system_prompt.txt',
        s3Key: '__prompts/chat/system_prompt.txt',
      },
      {
        id: 'InitVoiceSystemPrompt',
        localPath: 'src/prompts/voice/system_prompt.txt',
        s3Key: '__prompts/voice/system_prompt.txt',
      },
      {
        id: 'InitWebCrawlerSystemPrompt',
        localPath: 'src/prompts/webcrawler/system_prompt.txt',
        s3Key: '__prompts/webcrawler/system_prompt.txt',
      },
    ];

    for (const seed of promptSeeds) {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), seed.localPath),
        'utf-8',
      );
      new cr.AwsCustomResource(this, seed.id, {
        onCreate: {
          service: 'S3',
          action: 'putObject',
          parameters: {
            Bucket: agentStorageBucketName,
            Key: seed.s3Key,
            Body: content,
            ContentType: 'text/plain',
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${seed.id.toLowerCase()}-init`,
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [`${agentStorageBucket.bucketArn}/__prompts/*`],
          }),
        ]),
      });
    }

    // Initialize analysis prompts in S3 on first deployment
    const analysisPromptFiles = [
      'system_prompt',
      'user_query',
      'image_analysis_prompt',
      'video_system_prompt',
      'video_user_query',
      'video_analysis_prompt',
      'text_system_prompt',
      'text_user_query',
    ];

    for (const promptFile of analysisPromptFiles) {
      const promptPath = path.resolve(
        process.cwd(),
        `src/prompts/analysis/${promptFile}.txt`,
      );
      const promptContent = fs.readFileSync(promptPath, 'utf-8');
      const resourceId = `InitAnalysis${promptFile
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('')}`;

      new cr.AwsCustomResource(this, resourceId, {
        onCreate: {
          service: 'S3',
          action: 'putObject',
          parameters: {
            Bucket: agentStorageBucketName,
            Key: `__prompts/analysis/${promptFile}.txt`,
            Body: promptContent,
            ContentType: 'text/plain',
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `analysis-${promptFile}-init`,
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [`${agentStorageBucket.bucketArn}/__prompts/*`],
          }),
        ]),
      });
    }

    const idpAgent = new IdpAgent(this, 'IdpAgent', {
      agentPath: path.resolve(process.cwd(), '../../packages/agents/idp-agent'),
      agentName: 'idp_agent',
      sessionStorageBucket,
      backendTable,
      gateway,
      bedrockModelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      agentStorageBucket,
      websocketMessageQueue,
    });

    // Create Code Interpreter for Research Agent
    const codeInterpreter = new CodeInterpreterCustom(this, 'CodeInterpreter', {
      codeInterpreterCustomName: 'research_agent_interpreter',
      description: 'Code interpreter for research agent',
    });
    agentStorageBucket.grantReadWrite(codeInterpreter.executionRole);

    const researchAgent = new IdpAgent(this, 'ResearchAgent', {
      agentPath: path.resolve(
        process.cwd(),
        '../../packages/agents/research-agent',
      ),
      agentName: 'research_agent',
      sessionStorageBucket,
      backendTable,
      gateway,
      agentStorageBucket,
      codeInterpreterIdentifier: codeInterpreter.codeInterpreterId,
    });

    codeInterpreter.grantUse(researchAgent.runtime.role);

    this.agentCoreRuntime = idpAgent.runtime;

    // Store Agent Runtime ARN in SSM for cross-stack reference
    new StringParameter(this, 'AgentRuntimeArnParam', {
      parameterName: SSM_KEYS.AGENT_RUNTIME_ARN,
      stringValue: this.agentCoreRuntime.agentRuntimeArn,
      description: 'ARN of the IDP Agent Runtime',
    });

    new StringParameter(this, 'ResearchAgentRuntimeArnParam', {
      parameterName: SSM_KEYS.RESEARCH_AGENT_RUNTIME_ARN,
      stringValue: researchAgent.runtime.agentRuntimeArn,
      description: 'ARN of the Research Agent Runtime',
    });

    const bidiAgent = new IdpAgent(this, 'BidiAgent', {
      agentPath: path.resolve(
        process.cwd(),
        '../../packages/agents/bidi-agent',
      ),
      agentName: 'bidi_agent',
      sessionStorageBucket,
      backendTable,
      gateway,
      agentStorageBucket,
    });

    new StringParameter(this, 'BidiAgentRuntimeArnParam', {
      parameterName: SSM_KEYS.BIDI_AGENT_RUNTIME_ARN,
      stringValue: bidiAgent.runtime.agentRuntimeArn,
      description: 'ARN of the Bidi Agent Runtime',
    });

    // Get document storage bucket from SSM
    const documentBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );

    const documentBucket = Bucket.fromBucketName(
      this,
      'DocumentBucket',
      documentBucketName,
    );

    // WebCrawler Agent - crawls web pages using AgentCore Browser
    const webcrawlerAgent = new IdpAgent(this, 'WebCrawlerAgent', {
      agentPath: path.resolve(
        process.cwd(),
        '../../packages/agents/webcrawler-agent',
      ),
      agentName: 'webcrawler_agent',
      sessionStorageBucket,
      backendTable,
      gateway,
      documentBucket,
      agentStorageBucket,
    });

    new StringParameter(this, 'WebCrawlerAgentRuntimeArnParam', {
      parameterName: SSM_KEYS.WEBCRAWLER_AGENT_RUNTIME_ARN,
      stringValue: webcrawlerAgent.runtime.agentRuntimeArn,
      description: 'ARN of the WebCrawler Agent Runtime',
    });
  }
}
