import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface ArtifactMetadata {
  artifact_id: string;
  created_at: string;
  data: {
    user_id: string;
    project_id: string;
    filename: string;
    content_type: string;
    s3_key: string;
    s3_bucket: string;
    file_size: number;
  };
}

export async function saveArtifactMetadata(
  table: string,
  metadata: ArtifactMetadata,
): Promise<void> {
  const { user_id, project_id } = metadata.data;

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `ART#${metadata.artifact_id}`,
        SK: 'META',
        GSI1PK: `USR#${user_id}#ART`,
        GSI1SK: metadata.created_at,
        GSI2PK: `USR#${user_id}#PROJ#${project_id}#ART`,
        GSI2SK: metadata.created_at,
        ...metadata,
      },
    }),
  );
}

export async function getArtifactMetadata(
  table: string,
  artifactId: string,
): Promise<ArtifactMetadata | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: {
        PK: `ART#${artifactId}`,
        SK: 'META',
      },
    }),
  );

  if (!result.Item) {
    return null;
  }

  return result.Item as ArtifactMetadata;
}
