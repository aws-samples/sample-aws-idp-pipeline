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
import { WebsocketStack } from './stacks/websocket-stack.js';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Layer 1: VPC
const vpcStack = new VpcStack(app, 'IDP-V2-Vpc', { env });

// Layer 2: Storage (depends on VPC)
const storageStack = new StorageStack(app, 'IDP-V2-Storage', { env });
storageStack.addDependency(vpcStack);

// Layer 3: OCR (depends on Storage)
const ocrStack = new OcrStack(app, 'IDP-V2-Ocr', { env });
ocrStack.addDependency(storageStack);

// Layer 4: Event (depends on Storage, OCR)
const eventStack = new EventStack(app, 'IDP-V2-Event', { env });
eventStack.addDependency(storageStack);
eventStack.addDependency(ocrStack);

// Layer 5: Preprocessing consumers (depend on Event)
const bdaStack = new BdaStack(app, 'IDP-V2-Bda', { env });
bdaStack.addDependency(eventStack);

const transcribeStack = new TranscribeStack(app, 'IDP-V2-Transcribe', { env });
transcribeStack.addDependency(eventStack);

// Layer 5: Workflow (depends on Storage, Event)
const workflowStack = new WorkflowStack(app, 'IDP-V2-Workflow', { env });
workflowStack.addDependency(storageStack);
workflowStack.addDependency(eventStack);

// Layer 5: Websocket (depends on Storage, VPC)
const websocketStack = new WebsocketStack(app, 'IDP-V2-Websocket', { env });
websocketStack.addDependency(storageStack);
websocketStack.addDependency(vpcStack);

// Layer 6: Mcp (depends on Storage, Websocket, VPC)
const mcpStack = new McpStack(app, 'IDP-V2-Mcp', { env });
mcpStack.addDependency(storageStack);
mcpStack.addDependency(websocketStack);
mcpStack.addDependency(vpcStack);

// Layer 6: Worker (depends on Storage, Websocket, VPC)
const workerStack = new WorkerStack(app, 'IDP-V2-Worker', { env });
workerStack.addDependency(storageStack);
workerStack.addDependency(websocketStack);
workerStack.addDependency(vpcStack);

// Layer 7: Agent (depends on Storage, Mcp)
const agentStack = new AgentStack(app, 'IDP-V2-Agent', {
  env,
  gateway: mcpStack.gateway,
});
agentStack.addDependency(storageStack);
agentStack.addDependency(mcpStack);

// Layer 8: Application (depends on Agent, Websocket, Mcp, Workflow, VPC)
const applicationStack = new ApplicationStack(app, 'IDP-V2-Application', {
  env,
  crossRegionReferences: true,
});
applicationStack.addDependency(agentStack);
applicationStack.addDependency(websocketStack);
applicationStack.addDependency(mcpStack);
applicationStack.addDependency(workflowStack);
applicationStack.addDependency(vpcStack);

app.synth();
