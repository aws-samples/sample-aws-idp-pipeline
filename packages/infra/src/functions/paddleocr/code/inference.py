"""Multi-Model OCR Inference Script for SageMaker

Supports:
- PP-OCRv5: General-purpose OCR with high accuracy
- PP-StructureV3: Document structure analysis with table detection
- PaddleOCR-VL: Vision-language model for complex documents

Models are downloaded on-demand and cached in S3 for reuse.
"""
import os
import json
import tempfile
import logging
import shutil
import tarfile
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
import boto3
from botocore.exceptions import ClientError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model files location
MODEL_DIR = os.environ.get("SM_MODEL_DIR", "/opt/ml/model")
# Use /tmp for PADDLEOCR_HOME since /opt/ml/model is read-only in SageMaker
PADDLEOCR_HOME = "/tmp/.paddleocr"
os.environ["PADDLEOCR_HOME"] = PADDLEOCR_HOME

# S3 cache configuration (set via environment variables)
MODEL_CACHE_BUCKET = os.environ.get("MODEL_CACHE_BUCKET", "")
MODEL_CACHE_PREFIX = os.environ.get("MODEL_CACHE_PREFIX", "paddleocr/models")

s3_client = None


def get_s3_client():
    """Get or create S3 client."""
    global s3_client
    if s3_client is None:
        s3_client = boto3.client("s3")
    return s3_client


def s3_cache_exists(model_key: str) -> bool:
    """Check if model cache exists in S3."""
    if not MODEL_CACHE_BUCKET:
        return False
    try:
        s3 = get_s3_client()
        s3.head_object(Bucket=MODEL_CACHE_BUCKET, Key=f"{MODEL_CACHE_PREFIX}/{model_key}.tar.gz")
        return True
    except ClientError:
        return False


def download_from_s3_cache(model_key: str) -> bool:
    """Download model from S3 cache to local PADDLEOCR_HOME."""
    if not MODEL_CACHE_BUCKET:
        return False
    try:
        s3 = get_s3_client()
        cache_path = f"{MODEL_CACHE_PREFIX}/{model_key}.tar.gz"
        local_tar = f"/tmp/{model_key}.tar.gz"

        logger.info(f"Downloading model cache from s3://{MODEL_CACHE_BUCKET}/{cache_path}")
        s3.download_file(MODEL_CACHE_BUCKET, cache_path, local_tar)

        # Extract to PADDLEOCR_HOME
        os.makedirs(PADDLEOCR_HOME, exist_ok=True)
        with tarfile.open(local_tar, "r:gz") as tar:
            tar.extractall(PADDLEOCR_HOME)

        os.unlink(local_tar)
        logger.info(f"Model cache extracted to {PADDLEOCR_HOME}")
        return True
    except Exception as e:
        logger.warning(f"Failed to download from S3 cache: {e}")
        return False


def upload_to_s3_cache(model_key: str) -> bool:
    """Upload local model files to S3 cache."""
    if not MODEL_CACHE_BUCKET:
        logger.info("MODEL_CACHE_BUCKET not set, skipping S3 cache upload")
        return False
    try:
        s3 = get_s3_client()
        cache_path = f"{MODEL_CACHE_PREFIX}/{model_key}.tar.gz"
        local_tar = f"/tmp/{model_key}_upload.tar.gz"

        # Create tar.gz of PADDLEOCR_HOME
        logger.info(f"Creating model cache archive...")
        with tarfile.open(local_tar, "w:gz") as tar:
            for item in os.listdir(PADDLEOCR_HOME):
                tar.add(os.path.join(PADDLEOCR_HOME, item), arcname=item)

        # Upload to S3
        logger.info(f"Uploading model cache to s3://{MODEL_CACHE_BUCKET}/{cache_path}")
        s3.upload_file(local_tar, MODEL_CACHE_BUCKET, cache_path)

        os.unlink(local_tar)
        logger.info("Model cache uploaded successfully")
        return True
    except Exception as e:
        logger.warning(f"Failed to upload to S3 cache: {e}")
        return False


class BaseOCRModel(ABC):
    """Abstract base class for OCR models."""

    def __init__(self):
        self._model = None

    @property
    @abstractmethod
    def model_name(self) -> str:
        pass

    @property
    def cache_key(self) -> str:
        """Key used for S3 caching. Override for language-specific caching."""
        return self.model_name

    @abstractmethod
    def load(self, options: Dict[str, Any] = None) -> None:
        pass

    @abstractmethod
    def predict(self, image_path: str, options: Dict[str, Any] = None) -> List[Any]:
        pass

    def ensure_cached(self) -> None:
        """Ensure model is cached in S3 after first download."""
        if MODEL_CACHE_BUCKET and not s3_cache_exists(self.cache_key):
            logger.info(f"Caching {self.cache_key} to S3 for future use...")
            upload_to_s3_cache(self.cache_key)

    def format_output(self, results: List[Any], output_format: str = "markdown") -> Dict[str, Any]:
        """Format the prediction results."""
        output = {"success": True, "format": output_format, "results": [], "content": "", "blocks": []}

        for res in results:
            if hasattr(res, "json"):
                res_json = res.json
                output["results"].append(res_json)
                res_data = res_json.get("res", res_json)
                parsing_list = res_data.get("parsing_res_list", [])

                # Store blocks for frontend visualization
                for block in parsing_list:
                    output["blocks"].append({
                        "block_id": block.get("block_id", 0),
                        "block_label": block.get("block_label", "text"),
                        "block_content": block.get("block_content", ""),
                        "block_bbox": block.get("block_bbox", []),
                        "block_order": block.get("block_order"),
                        "group_id": block.get("group_id", 0),
                    })

                # Generate text content for LanceDB (skip empty blocks)
                for block in parsing_list:
                    block_content = block.get("block_content", "").strip()
                    block_label = block.get("block_label", "text")

                    # Skip blocks with no text content (e.g., figure, chart, image)
                    if not block_content:
                        continue

                    if output_format == "markdown":
                        if block_label == "doc_title":
                            output["content"] += f"# {block_content}\n\n"
                        elif block_label == "paragraph_title":
                            output["content"] += f"## {block_content}\n\n"
                        elif block_label == "table":
                            output["content"] += f"{block_content}\n\n"
                        else:
                            output["content"] += f"{block_content}\n\n"
                    elif output_format == "html":
                        if block_label == "doc_title":
                            output["content"] += f"<h1>{block_content}</h1>\n"
                        elif block_label == "paragraph_title":
                            output["content"] += f"<h2>{block_content}</h2>\n"
                        elif block_label == "table":
                            output["content"] += f"{block_content}\n"
                        else:
                            output["content"] += f"<p>{block_content}</p>\n"

        return output


class PPOcrV5Model(BaseOCRModel):
    """PP-OCRv5: General-purpose OCR with high accuracy."""

    def __init__(self):
        super().__init__()
        self._current_lang = None

    @property
    def model_name(self) -> str:
        return "pp-ocrv5"

    @property
    def cache_key(self) -> str:
        lang = self._current_lang or "default"
        return f"{self.model_name}-{lang}"

    def load(self, options: Dict[str, Any] = None) -> None:
        opts = options or {}
        lang = opts.get("lang") or None
        self._current_lang = lang

        cache_key = self.cache_key

        # Try to load from S3 cache first
        if not s3_cache_exists(cache_key):
            logger.info(f"No S3 cache found for {cache_key}, will download from HuggingFace")
        else:
            logger.info(f"Found S3 cache for {cache_key}, downloading...")
            download_from_s3_cache(cache_key)

        logger.info(f"Loading PP-OCRv5 model with lang={lang}...")
        from paddleocr import PaddleOCR

        ocr_kwargs = {
            "use_doc_orientation_classify": opts.get("use_doc_orientation_classify", False),
            "use_doc_unwarping": opts.get("use_doc_unwarping", False),
            "use_textline_orientation": opts.get("use_textline_orientation", False),
        }
        if lang:
            ocr_kwargs["lang"] = lang

        self._model = PaddleOCR(**ocr_kwargs)
        logger.info(f"PP-OCRv5 model loaded successfully")

        # Cache to S3 if not already cached
        self.ensure_cached()

    def predict(self, image_path: str, options: Dict[str, Any] = None) -> List[Any]:
        opts = options or {}
        requested_lang = opts.get("lang") or None
        if self._model is None or self._current_lang != requested_lang:
            self.load(options)
        return self._model.predict(input=image_path)

    def format_output(self, results: List[Any], output_format: str = "markdown") -> Dict[str, Any]:
        output = {"success": True, "format": output_format, "results": [], "content": "", "blocks": []}

        for res in results:
            if hasattr(res, "json"):
                res_data = res.json.get("res", {})
                rec_texts = res_data.get("rec_texts", [])
                rec_polys = res_data.get("rec_polys", [])
                rec_boxes = res_data.get("rec_boxes", [])

                output["results"].append(res.json)
                # Filter empty texts
                output["content"] = "\n".join(t for t in rec_texts if t.strip())

                # Create synthetic blocks from PP-OCRv5 results
                for idx, text in enumerate(rec_texts):
                    # Get bounding box from rec_polys or rec_boxes
                    bbox = []
                    if rec_polys and idx < len(rec_polys):
                        poly = rec_polys[idx]
                        if poly and len(poly) == 4:
                            xs = [p[0] for p in poly]
                            ys = [p[1] for p in poly]
                            bbox = [min(xs), min(ys), max(xs), max(ys)]
                    elif rec_boxes and idx < len(rec_boxes):
                        box = rec_boxes[idx]
                        if len(box) == 4:
                            bbox = box
                        elif len(box) == 8:
                            xs = [box[i] for i in range(0, 8, 2)]
                            ys = [box[i] for i in range(1, 8, 2)]
                            bbox = [min(xs), min(ys), max(xs), max(ys)]

                    output["blocks"].append({
                        "block_id": idx,
                        "block_label": "text",
                        "block_content": text,
                        "block_bbox": bbox,
                        "block_order": idx,
                        "group_id": 0,
                    })

        return output


class PPStructureV3Model(BaseOCRModel):
    """PP-StructureV3: Document structure analysis with table detection."""

    def __init__(self):
        super().__init__()
        self._current_lang = None

    @property
    def model_name(self) -> str:
        return "pp-structurev3"

    @property
    def cache_key(self) -> str:
        lang = self._current_lang or "default"
        return f"{self.model_name}-{lang}"

    def load(self, options: Dict[str, Any] = None) -> None:
        opts = options or {}
        lang = opts.get("lang") or None
        self._current_lang = lang

        cache_key = self.cache_key

        # Try to load from S3 cache first
        if not s3_cache_exists(cache_key):
            logger.info(f"No S3 cache found for {cache_key}, will download from HuggingFace")
        else:
            logger.info(f"Found S3 cache for {cache_key}, downloading...")
            download_from_s3_cache(cache_key)

        logger.info(f"Loading PP-StructureV3 model with lang={lang}...")
        from paddleocr import PPStructureV3

        ocr_kwargs = {
            "use_doc_orientation_classify": opts.get("use_doc_orientation_classify", False),
            "use_doc_unwarping": opts.get("use_doc_unwarping", False),
        }
        if lang:
            ocr_kwargs["lang"] = lang

        self._model = PPStructureV3(**ocr_kwargs)
        logger.info(f"PP-StructureV3 model loaded successfully")

        # Cache to S3 if not already cached
        self.ensure_cached()

    def predict(self, image_path: str, options: Dict[str, Any] = None) -> List[Any]:
        opts = options or {}
        requested_lang = opts.get("lang") or None
        if self._model is None or self._current_lang != requested_lang:
            self.load(options)
        return self._model.predict(input=image_path)

    def format_output(self, results: List[Any], output_format: str = "markdown") -> Dict[str, Any]:
        output = {"success": True, "format": output_format, "results": [], "content": "", "blocks": []}

        for res in results:
            if hasattr(res, "json"):
                output["results"].append(res.json)
                res_data = res.json.get("res", {})
                parsing_list = res_data.get("parsing_res_list", [])

                # Store blocks for frontend visualization
                for block in parsing_list:
                    output["blocks"].append({
                        "block_id": block.get("block_id", 0),
                        "block_label": block.get("block_label", "text"),
                        "block_content": block.get("block_content", ""),
                        "block_bbox": block.get("block_bbox", []),
                        "block_order": block.get("block_order"),
                        "group_id": block.get("group_id", 0),
                    })

                # Generate text content for LanceDB (skip empty blocks)
                content_parts = []
                for block in parsing_list:
                    block_content = block.get("block_content", "").strip()
                    block_label = block.get("block_label", "text")

                    # Skip blocks with no text content (e.g., figure, chart, image)
                    if not block_content:
                        continue

                    if output_format == "markdown":
                        if block_label == "doc_title":
                            content_parts.append(f"# {block_content}")
                        elif block_label == "paragraph_title":
                            content_parts.append(f"## {block_content}")
                        else:
                            content_parts.append(block_content)
                    else:
                        content_parts.append(block_content)

                output["content"] = "\n\n".join(content_parts)

        return output


class PaddleOCRVLModel(BaseOCRModel):
    """PaddleOCR-VL: Vision-language model for complex documents."""

    @property
    def model_name(self) -> str:
        return "paddleocr-vl"

    def load(self, options: Dict[str, Any] = None) -> None:
        cache_key = self.cache_key

        # Try to load from S3 cache first
        if not s3_cache_exists(cache_key):
            logger.info(f"No S3 cache found for {cache_key}, will download from HuggingFace")
        else:
            logger.info(f"Found S3 cache for {cache_key}, downloading...")
            download_from_s3_cache(cache_key)

        logger.info("Loading PaddleOCR-VL model...")
        from paddleocr import PaddleOCRVL
        self._model = PaddleOCRVL()
        logger.info("PaddleOCR-VL model loaded successfully")

        # Cache to S3 if not already cached
        self.ensure_cached()

    def predict(self, image_path: str, options: Dict[str, Any] = None) -> List[Any]:
        if self._model is None:
            self.load(options)
        return self._model.predict(input=image_path)


MODEL_REGISTRY: Dict[str, type] = {
    "pp-ocrv5": PPOcrV5Model,
    "pp-structurev3": PPStructureV3Model,
    "paddleocr-vl": PaddleOCRVLModel,
}

_model_cache: Dict[str, BaseOCRModel] = {}


def get_model(model_name: str) -> BaseOCRModel:
    """Get or create a model instance from the registry."""
    if model_name not in MODEL_REGISTRY:
        available = ", ".join(MODEL_REGISTRY.keys())
        raise ValueError(f"Unknown model: {model_name}. Available: {available}")

    if model_name not in _model_cache:
        logger.info(f"Creating new instance of {model_name}")
        _model_cache[model_name] = MODEL_REGISTRY[model_name]()

    return _model_cache[model_name]


# SageMaker Entry Points


def model_fn(model_dir):
    """Initialize S3 client and set model directory."""
    global s3_client
    logger.info(f"Initializing OCR service with model_dir: {model_dir}")
    logger.info(f"PADDLEOCR_HOME set to: {PADDLEOCR_HOME}")
    logger.info(f"MODEL_CACHE_BUCKET: {MODEL_CACHE_BUCKET}")
    logger.info(f"MODEL_CACHE_PREFIX: {MODEL_CACHE_PREFIX}")

    # Ensure PADDLEOCR_HOME exists
    os.makedirs(PADDLEOCR_HOME, exist_ok=True)

    s3_client = boto3.client("s3")
    logger.info("OCR service initialized. Models will be loaded on demand with S3 caching.")
    return {"initialized": True, "model_dir": model_dir}


def input_fn(request_body, content_type):
    """Parse input JSON."""
    if content_type == "application/json":
        return json.loads(request_body)
    raise ValueError(f"Unsupported content type: {content_type}")


def predict_fn(input_data, model):
    """Main prediction function with model routing.

    Supports:
    - Single images (PNG, TIFF, JPEG)
    - PDF files (PaddleOCR handles PDF directly)
    """
    global s3_client

    s3_uri = input_data.get("s3_uri")
    output_key = input_data.get("output_key")
    model_name = input_data.get("model", "paddleocr-vl")
    model_options = input_data.get("model_options", {})
    metadata = input_data.get("metadata", {})

    if not s3_uri:
        raise ValueError("s3_uri is required")

    logger.info(f"Processing with model: {model_name}, options: {model_options}")

    # Parse S3 URI
    s3_uri_clean = s3_uri.replace("s3://", "")
    bucket = s3_uri_clean.split("/")[0]
    key = "/".join(s3_uri_clean.split("/")[1:])

    # Download file to temp
    suffix = os.path.splitext(key)[1].lower() or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        s3_client.download_file(bucket, key, tmp.name)
        tmp_path = tmp.name

    try:
        ocr_model = get_model(model_name)

        # PaddleOCR handles both images and PDFs directly
        logger.info(f"Processing file: {tmp_path} (type: {suffix})")
        results = ocr_model.predict(tmp_path, model_options)

        # Format results - PaddleOCR returns list of results (one per page for PDF)
        pages = []
        all_content = []

        for page_idx, res in enumerate(results):
            page_output = ocr_model.format_output([res], output_format="markdown")

            # Extract image dimensions from result data
            width, height = None, None
            if hasattr(res, "json"):
                res_data = res.json.get("res", {})
                width = res_data.get("width")
                height = res_data.get("height")

            pages.append({
                "page_index": page_idx,
                "content": page_output.get("content", ""),
                "blocks": page_output.get("blocks", []),
                "width": width,
                "height": height,
                "results": page_output.get("results", [])
            })
            all_content.append(page_output.get("content", ""))

        output = {
            "success": True,
            "format": "markdown",
            "pages": pages,
            "page_count": len(pages),
            "content": "\n\n---\n\n".join(all_content),
            "model": model_name,
            "model_options": model_options,
            "metadata": metadata
        }

        # Upload result to S3 if output_key specified
        if output_key:
            s3_client.put_object(
                Bucket=bucket,
                Key=output_key,
                Body=json.dumps(output, ensure_ascii=False),
                ContentType="application/json"
            )
            logger.info(f"Result uploaded to s3://{bucket}/{output_key}")

        return output

    except Exception as e:
        logger.error(f"Prediction error: {str(e)}")
        error_output = {"success": False, "error": str(e), "model": model_name}
        if output_key:
            error_key = output_key.replace("output/", "failure/")
            s3_client.put_object(
                Bucket=bucket,
                Key=error_key,
                Body=json.dumps(error_output, ensure_ascii=False),
                ContentType="application/json"
            )
        raise

    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def output_fn(prediction, accept):
    """Format output response."""
    return json.dumps(prediction, ensure_ascii=False)
