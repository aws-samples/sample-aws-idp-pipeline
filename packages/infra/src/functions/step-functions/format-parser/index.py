import json
from parsers import parse_pdf

PARSERS = {
    'application/pdf': parse_pdf,
    # Future formats:
    # 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parse_docx,
    # 'application/vnd.openxmlformats-officedocument.presentationml.presentation': parse_pptx,
    # 'image/png': parse_image,
    # 'image/jpeg': parse_image,
}


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    file_type = event.get('file_type', '')

    parser = PARSERS.get(file_type)

    if parser is None:
        print(f'No parser available for file type: {file_type}')
        return {
            **event,
            'format_parsing': 'skipped',
            'format_parsing_reason': f'No parser for {file_type}'
        }

    try:
        result = parser(event)
        return {
            **result,
            'format_parsing': 'completed'
        }
    except Exception as e:
        print(f'Error in format parsing: {e}')
        return {
            **event,
            'format_parsing': 'failed',
            'format_parsing_error': str(e)
        }
