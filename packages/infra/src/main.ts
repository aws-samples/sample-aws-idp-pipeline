import { ApplicationStack } from './stacks/application-stack.js';
import { AgentStack } from './stacks/agent-stack.js';
import { McpStack } from './stacks/mcp-stack.js';
import { App } from ':idp-v2/common-constructs';
import { StorageStack } from './stacks/storage-stack.js';
import { EventStack } from './stacks/event-stack.js';
import { BdaStack } from './stacks/bda-stack.js';
import { OcrStack } from './stacks/ocr-stack.js';
import { TranscribeStack } from './stacks/transcribe-stack.js';
import { WorkflowStack } from './stacks/workflow-stack.js';
import { VpcStack } from './stacks/vpc-stack.js';
import { WorkerStack } from './stacks/worker-stack.js';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new VpcStack(app, 'IDP-V2-Vpc', {
  env,
});

new StorageStack(app, 'IDP-V2-Storage', {
  env,
});

// Event Stack - S3 EventBridge, SQS queues, type-detection
new EventStack(app, 'IDP-V2-Event', {
  env,
});

// Preprocessing consumer stacks (depend on EventStack for queue ARNs)
new BdaStack(app, 'IDP-V2-Bda', {
  env,
});

new OcrStack(app, 'IDP-V2-Ocr', {
  env,
});

new TranscribeStack(app, 'IDP-V2-Transcribe', {
  env,
});

// Workflow Stack - Step Functions for AI analysis (depends on EventStack for workflow queue)
new WorkflowStack(app, 'IDP-V2-Workflow', {
  env,
});

new WorkerStack(app, 'IDP-V2-Worker', {
  env,
});

const mcpStack = new McpStack(app, 'IDP-V2-Mcp', {
  env,
});

new AgentStack(app, 'IDP-V2-Agent', {
  env,
  gateway: mcpStack.gateway,
});

new ApplicationStack(app, 'IDP-V2-Application', {
  env,
  crossRegionReferences: true,
});

app.synth();
