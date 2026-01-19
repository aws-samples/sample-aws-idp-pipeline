from unittest.mock import patch

from app.markdown import fix_image_uri, transform_markdown_images


class TestFixImageUri:
    def test_empty_string(self):
        assert fix_image_uri("") == ""

    def test_none_like_empty(self):
        assert fix_image_uri("") == ""

    def test_non_s3_uri(self):
        assert fix_image_uri("https://example.com/image.png") == "https://example.com/image.png"

    def test_already_has_assets(self):
        uri = "s3://bucket/path/to/assets/image.png"
        assert fix_image_uri(uri) == uri

    def test_adds_assets_path(self):
        uri = "s3://bucket/path/to/image.png"
        expected = "s3://bucket/path/to/assets/image.png"
        assert fix_image_uri(expected) == expected
        assert fix_image_uri(uri) == expected

    def test_single_segment_path(self):
        uri = "s3://bucket/image.png"
        expected = "s3://bucket/assets/image.png"
        assert fix_image_uri(uri) == expected


class TestTransformMarkdownImages:
    def test_empty_markdown(self):
        assert transform_markdown_images("") == ""
        assert transform_markdown_images(None) is None

    def test_no_images(self):
        markdown = "This is plain text without images."
        assert transform_markdown_images(markdown) == markdown

    @patch("app.markdown.generate_presigned_url")
    def test_relative_path_with_assets_base(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        markdown = "![alt](./image.png)"
        image_uri = "s3://bucket/path/assets/base.png"

        result = transform_markdown_images(markdown, image_uri)

        assert "https://presigned.url/image.png" in result
        mock_presigned.assert_called_with("s3://bucket/path/assets/image.png")

    @patch("app.markdown.generate_presigned_url")
    def test_plain_filename(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        markdown = "![alt](image.png)"
        image_uri = "s3://bucket/path/assets/base.png"

        result = transform_markdown_images(markdown, image_uri)

        assert "https://presigned.url/image.png" in result

    @patch("app.markdown.generate_presigned_url")
    def test_s3_uri_with_assets(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        markdown = "![alt](s3://bucket/path/assets/image.png)"

        result = transform_markdown_images(markdown)

        assert "https://presigned.url/image.png" in result
        mock_presigned.assert_called_with("s3://bucket/path/assets/image.png")

    @patch("app.markdown.generate_presigned_url")
    def test_s3_uri_without_assets_adds_assets(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        markdown = "![alt](s3://bucket/path/image.png)"

        result = transform_markdown_images(markdown)

        assert "https://presigned.url/image.png" in result
        # First call should try with /assets/
        mock_presigned.assert_any_call("s3://bucket/path/assets/image.png")

    def test_http_url_unchanged(self):
        markdown = "![alt](https://example.com/image.png)"
        result = transform_markdown_images(markdown)
        assert "https://example.com/image.png" in result

    @patch("app.markdown.generate_presigned_url")
    def test_alt_text_cleanup(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        # Alt text with newlines and brackets
        markdown = "![text\nwith\nnewlines [and] brackets](./image.png)"
        image_uri = "s3://bucket/assets/base.png"

        result = transform_markdown_images(markdown, image_uri)

        # Should have cleaned alt text
        assert "text with newlines" in result
        assert "\\[and\\]" in result

    @patch("app.markdown.generate_presigned_url")
    def test_long_alt_text_truncated(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        long_alt = "a" * 150
        markdown = f"![{long_alt}](./image.png)"
        image_uri = "s3://bucket/assets/base.png"

        result = transform_markdown_images(markdown, image_uri)

        # Should be truncated to 100 chars + "..."
        assert "..." in result

    @patch("app.markdown.generate_presigned_url")
    def test_multiple_images(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        markdown = "![first](./a.png) some text ![second](./b.png)"
        image_uri = "s3://bucket/assets/base.png"

        result = transform_markdown_images(markdown, image_uri)

        assert result.count("https://presigned.url/image.png") == 2

    @patch("app.markdown.generate_presigned_url")
    def test_image_uri_without_assets_constructs_base(self, mock_presigned):
        mock_presigned.return_value = "https://presigned.url/image.png"

        markdown = "![alt](./image.png)"
        image_uri = "s3://bucket/path/to/base.png"  # No /assets/

        result = transform_markdown_images(markdown, image_uri)

        # Should construct assets base from parent dir
        mock_presigned.assert_called_with("s3://bucket/path/to/assets/image.png")

    @patch("app.markdown.generate_presigned_url")
    def test_presigned_url_failure_keeps_original(self, mock_presigned):
        mock_presigned.return_value = None

        markdown = "![alt](./image.png)"
        image_uri = "s3://bucket/assets/base.png"

        result = transform_markdown_images(markdown, image_uri)

        # Should keep original path when presigned fails
        assert "./image.png" in result
