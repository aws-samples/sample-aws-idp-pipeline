from pydantic import BaseModel


class ProjectData(BaseModel):
    project_id: str
    name: str
    description: str
    status: str
    created_by: str | None = None


class Project(BaseModel):
    data: ProjectData
    created_at: str
    updated_at: str


class DocumentData(BaseModel):
    document_id: str
    project_id: str
    name: str
    file_type: str
    file_size: int
    status: str
    s3_key: str


class Document(BaseModel):
    data: DocumentData
    created_at: str
    updated_at: str


class WorkflowData(BaseModel):
    execution_arn: str
    file_name: str
    file_type: str
    file_uri: str
    project_id: str
    status: str
    summary: str | None = None
    total_segments: int | None = None


class Workflow(BaseModel):
    PK: str
    SK: str
    data: WorkflowData
    created_at: str
    updated_at: str


class ImageAnalysis(BaseModel):
    analysis_query: str
    content: str


class SegmentData(BaseModel):
    segment_index: int
    image_uri: str
    bda_indexer: str
    format_parser: str
    image_analysis: list[ImageAnalysis]


class Segment(BaseModel):
    data: SegmentData
    created_at: str
    updated_at: str
