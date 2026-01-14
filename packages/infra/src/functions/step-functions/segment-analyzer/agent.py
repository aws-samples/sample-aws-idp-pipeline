import os
import tempfile
from typing import Optional
from urllib.parse import urlparse

import boto3
import yaml
from strands import Agent
from strands.models import BedrockModel

from tools import create_image_analyzer_tool, create_image_rotator_tool


class VisionReactAgent:
    def __init__(self, model_id: str, region: str = 'us-east-1'):
        self.model_id = model_id
        self.region = region
        self.s3_client = boto3.client('s3', region_name=region)
        self.bedrock_client = boto3.client('bedrock-runtime', region_name=region)
        self.analysis_steps = []
        self.current_image_data = None
        self.previous_context = ''

    def _load_prompt(self, prompt_name: str) -> str:
        prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'vision_react_agent.yaml')
        try:
            with open(prompt_path, 'r', encoding='utf-8') as f:
                prompts = yaml.safe_load(f)
                return prompts.get(prompt_name, '')
        except Exception as e:
            print(f'Error loading prompt: {e}')
            return ''

    def _download_image(self, image_uri: str) -> Optional[bytes]:
        if not image_uri:
            return None

        try:
            parsed = urlparse(image_uri)
            bucket = parsed.netloc
            key = parsed.path.lstrip('/')

            print(f'Downloading image from s3://{bucket}/{key}')

            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                self.s3_client.download_file(bucket, key, tmp.name)
                with open(tmp.name, 'rb') as f:
                    image_data = f.read()
                os.unlink(tmp.name)

                size_mb = len(image_data) / (1024 * 1024)
                print(f'Image downloaded: {size_mb:.2f}MB')

                return image_data
        except Exception as e:
            print(f'Error downloading image: {e}')
            return None

    def _get_image_data(self) -> Optional[bytes]:
        return self.current_image_data

    def _set_image_data(self, data: bytes) -> None:
        self.current_image_data = data

    def _get_previous_context(self) -> str:
        return self.previous_context

    def analyze(
        self,
        document_id: str,
        segment_id: str,
        segment_index: int,
        image_uri: Optional[str],
        context: str,
        file_type: str,
        language: str = 'en'
    ) -> dict:
        self.analysis_steps = []
        self.previous_context = context

        if image_uri:
            self.current_image_data = self._download_image(image_uri)
        else:
            self.current_image_data = None

        # Language display names for prompts
        language_names = {
            'ko': 'Korean',
            'en': 'English',
            'ja': 'Japanese',
            'zh': 'Chinese'
        }
        language_name = language_names.get(language, 'English')

        model = BedrockModel(
            model_id=self.model_id,
            region_name=self.region
        )

        analyze_image = create_image_analyzer_tool(
            image_data_getter=self._get_image_data,
            previous_context_getter=self._get_previous_context,
            analysis_steps=self.analysis_steps,
            model_id=self.model_id,
            bedrock_client=self.bedrock_client,
            language=language_name
        )

        rotate_image = create_image_rotator_tool(
            image_data_getter=self._get_image_data,
            image_data_setter=self._set_image_data,
            analysis_steps=self.analysis_steps
        )

        system_prompt = self._load_prompt('system_prompt')
        if not system_prompt:
            system_prompt = """You are a Technical Document Analysis Expert. Analyze documents thoroughly using available tools.

When analyzing:
1. First verify image orientation. If text appears rotated or upside down, use rotate_image tool.
2. Use analyze_image tool with specific, targeted questions.
3. Explore multiple aspects: text, visuals, layout, data.
4. Provide comprehensive analysis."""

        # Add language instruction to system prompt
        system_prompt = f"{system_prompt}\n\nIMPORTANT: You MUST provide all analysis, questions, and answers in {language_name}."

        user_query = self._load_prompt('user_query')
        if user_query:
            user_query = user_query.format(
                segment_index=segment_index + 1,
                context=context,
                language=language_name
            )
        else:
            user_query = f"""Please analyze the following document segment (page {segment_index + 1}).

Previous analysis context:
{context}

Use the available tools to systematically analyze the document and provide results in the following format:

## Document Overview
## Key Findings
## Technical Details
## Visual Elements
## Recommendations

IMPORTANT: Provide all analysis in {language_name}."""

        agent = Agent(
            model=model,
            system_prompt=system_prompt,
            tools=[analyze_image, rotate_image]
        )

        try:
            print(f'Starting analysis for document {document_id}, segment {segment_index}')
            print(f'Image available: {self.current_image_data is not None}')

            result = agent(user_query)
            response_text = str(result)

            print(f'Analysis completed. Steps: {len(self.analysis_steps)}')
            print(f'Response length: {len(response_text)} chars')

            return {
                'success': True,
                'response': response_text,
                'analysis_steps': self.analysis_steps,
                'iterations': len(self.analysis_steps)
            }

        except Exception as e:
            print(f'Agent execution error: {e}')
            return {
                'success': False,
                'response': f'Analysis failed: {e}',
                'analysis_steps': self.analysis_steps,
                'iterations': len(self.analysis_steps)
            }
