import json
import os

from shared.ddb_client import (
    record_step_start,
    record_step_complete,
    record_step_error,
    StepName,
)

from parsers import parse_pdf


PARSERS = {
    'application/pdf': parse_pdf,
}


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    workflow_id = event.get('workflow_id')
    file_type = event.get('file_type', '')

    record_step_start(workflow_id, StepName.FORMAT_PARSER)

    parser = PARSERS.get(file_type)

    if parser is None:
        print(f'No parser available for file type: {file_type}')
        record_step_complete(
            workflow_id,
            StepName.FORMAT_PARSER,
            skipped=True,
            reason=f'No parser for {file_type}'
        )
        return {
            **event,
            'format_parsing': 'skipped',
            'format_parsing_reason': f'No parser for {file_type}'
        }

    try:
        result = parser(event)
        record_step_complete(workflow_id, StepName.FORMAT_PARSER)
        return {
            **result,
            'format_parsing': 'completed'
        }
    except Exception as e:
        print(f'Error in format parsing: {e}')
        record_step_error(workflow_id, StepName.FORMAT_PARSER, str(e))
        return {
            **event,
            'format_parsing': 'failed',
            'format_parsing_error': str(e)
        }
