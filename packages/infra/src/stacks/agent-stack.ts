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

    // Initialize default system prompt in S3 on first deployment
    const systemPromptPath = path.resolve(
      process.cwd(),
      'src/prompts/system_prompt.txt',
    );
    const systemPromptContent = fs.readFileSync(systemPromptPath, 'utf-8');

    new cr.AwsCustomResource(this, 'InitSystemPrompt', {
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: agentStorageBucketName,
          Key: '__prompts/system_prompt.txt',
          Body: systemPromptContent,
          ContentType: 'text/plain',
        },
        physicalResourceId: cr.PhysicalResourceId.of('system-prompt-init'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [`${agentStorageBucket.bucketArn}/__prompts/*`],
        }),
      ]),
    });

    // Initialize voice system prompt in S3 on first deployment
    const voiceSystemPromptPath = path.resolve(
      process.cwd(),
      'src/prompts/voice_system_prompt.txt',
    );
    const voiceSystemPromptContent = fs.readFileSync(
      voiceSystemPromptPath,
      'utf-8',
    );

    new cr.AwsCustomResource(this, 'InitVoiceSystemPrompt', {
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: agentStorageBucketName,
          Key: '__prompts/voice_system_prompt.txt',
          Body: voiceSystemPromptContent,
          ContentType: 'text/plain',
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          'voice-system-prompt-init',
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [`${agentStorageBucket.bucketArn}/__prompts/*`],
        }),
      ]),
    });

    // Initialize webcrawler system prompt in S3 on first deployment
    const webcrawlerSystemPromptPath = path.resolve(
      process.cwd(),
      'src/prompts/webcrawler_system_prompt.txt',
    );
    const webcrawlerSystemPromptContent = fs.readFileSync(
      webcrawlerSystemPromptPath,
      'utf-8',
    );

    new cr.AwsCustomResource(this, 'InitWebCrawlerSystemPrompt', {
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: agentStorageBucketName,
          Key: '__prompts/webcrawler_system_prompt.txt',
          Body: webcrawlerSystemPromptContent,
          ContentType: 'text/plain',
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          'webcrawler-system-prompt-init',
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [`${agentStorageBucket.bucketArn}/__prompts/*`],
        }),
      ]),
    });

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

    // Get backend URL from SSM for bidi-agent
    const backendUrl = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_URL,
    );

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
      backendUrl,
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
