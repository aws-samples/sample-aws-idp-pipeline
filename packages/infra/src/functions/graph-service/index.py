import hashlib
import json
import os
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

NEPTUNE_ENDPOINT = os.environ.get('NEPTUNE_ENDPOINT', '')
NEPTUNE_PORT = os.environ.get('NEPTUNE_PORT', '8182')

_session = None


def get_session():
    global _session
    if _session is None:
        _session = boto3.Session(
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
        )
    return _session


def run_query(query: str, parameters: dict = None) -> list:
    """Execute an openCypher query against Neptune DB Serverless via IAM-signed HTTPS."""
    if not NEPTUNE_ENDPOINT:
        raise RuntimeError('NEPTUNE_ENDPOINT environment variable is not set')

    session = get_session()
    credentials = session.get_credentials().get_frozen_credentials()
    region = session.region_name

    url = f'https://{NEPTUNE_ENDPOINT}:{NEPTUNE_PORT}/openCypher'
    body = {'query': query}
    if parameters:
        body['parameters'] = json.dumps(parameters)

    data = urllib.parse.urlencode(body).encode('utf-8')
    request = AWSRequest(
        method='POST',
        url=url,
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Host': f'{NEPTUNE_ENDPOINT}:{NEPTUNE_PORT}',
        },
    )
    SigV4Auth(credentials, 'neptune-db', region).add_auth(request)

    req = urllib.request.Request(
        url,
        data=data,
        headers=dict(request.headers),
        method='POST',
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.loads(resp.read())

    return payload.get('results', [])


def run_queries_parallel(queries: list[tuple[str, dict | None]]) -> list[list]:
    """Execute multiple openCypher queries in parallel. Returns results in the same order."""
    results = [None] * len(queries)
    with ThreadPoolExecutor(max_workers=len(queries)) as executor:
        future_to_idx = {
            executor.submit(run_query, q, p): i
            for i, (q, p) in enumerate(queries)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            results[idx] = future.result()
    return results


def entity_id(project_id: str, name: str, entity_type: str) -> str:
    """Generate a deterministic entity ID from project_id + name + type."""
    key = f'{project_id}:{name.lower().strip()}:{entity_type.lower()}'
    return hashlib.sha256(key.encode()).hexdigest()[:16]


# ========================================
# Write Actions
# ========================================

def action_add_segment_links(params: dict) -> dict:
    """Create Document + Segment nodes and BELONGS_TO, NEXT relationships.

    Supports chunked calls via start_index/end_index to avoid Lambda timeout.
    """
    project_id = params['project_id']
    workflow_id = params['workflow_id']
    document_id = params.get('document_id', '')
    file_name = params.get('file_name', '')
    file_type = params.get('file_type', '')
    segment_count = params.get('segment_count', 0)
    start_index = params.get('start_index', 0)
    end_index = params.get('end_index', segment_count)

    # Create Document node (idempotent MERGE, safe to call multiple times)
    run_query(
        'MERGE (d:Document {id: $doc_id}) '
        'SET d.project_id = $pid, d.workflow_id = $wid, '
        'd.file_name = $fname, d.file_type = $ftype',
        {
            'doc_id': document_id,
            'pid': project_id,
            'wid': workflow_id,
            'fname': file_name,
            'ftype': file_type,
        },
    )

    # Create Segment nodes + BELONGS_TO edges for the given range
    segments = [
        {'sid': f'{workflow_id}_{i:04d}', 'idx': i}
        for i in range(start_index, end_index)
    ]
    batch_size = 50
    for start in range(0, len(segments), batch_size):
        batch = segments[start:start + batch_size]
        run_query(
            'UNWIND $segments AS seg '
            'MERGE (s:Segment {id: seg.sid}) '
            'SET s.project_id = $pid, s.workflow_id = $wid, '
            's.document_id = $did, s.segment_index = seg.idx '
            'WITH s '
            'MATCH (d:Document {id: $did}) '
            'MERGE (s)-[:BELONGS_TO]->(d)',
            {
                'segments': batch,
                'pid': project_id,
                'wid': workflow_id,
                'did': document_id,
            },
        )

    # Create NEXT relationships for the given range
    next_start = max(start_index, 1) if start_index == 0 else start_index
    pairs = [
        {'curr': f'{workflow_id}_{i - 1:04d}', 'next': f'{workflow_id}_{i:04d}'}
        for i in range(next_start, end_index)
    ]
    for start in range(0, len(pairs), batch_size):
        batch = pairs[start:start + batch_size]
        run_query(
            'UNWIND $pairs AS p '
            'MATCH (a:Segment {id: p.curr}), (b:Segment {id: p.next}) '
            'MERGE (a)-[:NEXT]->(b)',
            {'pairs': batch},
        )

    return {
        'success': True,
        'document_id': document_id,
        'segment_range': f'{start_index}-{end_index}',
    }


def action_add_analyses(params: dict) -> dict:
    """Create Analysis nodes and BELONGS_TO relationships to Segment nodes."""
    project_id = params['project_id']
    workflow_id = params['workflow_id']
    document_id = params.get('document_id', '')
    analyses = params.get('analyses', [])

    items = [
        {
            'aid': f'{workflow_id}_{item["segment_index"]:04d}_{item["qa_index"]:02d}',
            'sid': f'{workflow_id}_{item["segment_index"]:04d}',
            'idx': item['segment_index'],
            'qidx': item['qa_index'],
            'q': item.get('question', ''),
        }
        for item in analyses
    ]

    batch_size = 50
    for start in range(0, len(items), batch_size):
        batch = items[start:start + batch_size]
        run_query(
            'UNWIND $items AS item '
            'MERGE (a:Analysis {id: item.aid}) '
            'SET a.project_id = $pid, a.workflow_id = $wid, '
            'a.document_id = $did, a.segment_index = item.idx, '
            'a.qa_index = item.qidx, a.question = item.q '
            'WITH a, item '
            'MATCH (s:Segment {id: item.sid}) '
            'MERGE (a)-[:BELONGS_TO]->(s)',
            {
                'items': batch,
                'pid': project_id,
                'wid': workflow_id,
                'did': document_id,
            },
        )

    return {'success': True, 'created': len(items)}


def action_add_entities(params: dict) -> dict:
    """Add entity nodes in bulk with MENTIONED_IN relationships to Analysis nodes."""
    project_id = params['project_id']
    entities = params.get('entities', [])

    # Batch MERGE entity nodes
    entity_items = [
        {
            'eid': entity_id(project_id, ent['name'], ent['type']),
            'name': ent['name'],
            'type': ent['type'],
        }
        for ent in entities
    ]

    batch_size = 50
    for start in range(0, len(entity_items), batch_size):
        batch = entity_items[start:start + batch_size]
        run_query(
            'UNWIND $items AS item '
            'MERGE (e:Entity {id: item.eid}) '
            'SET e.project_id = $pid, e.name = item.name, e.type = item.type',
            {'items': batch, 'pid': project_id},
        )

    # Batch MERGE MENTIONED_IN relationships
    mention_items = []
    for ent in entities:
        eid = entity_id(project_id, ent['name'], ent['type'])
        for mention in ent.get('mentioned_in', []):
            workflow_id = mention.get('workflow_id', '')
            segment_index = mention.get('segment_index', 0)
            qa_index = mention.get('qa_index', 0)
            mention_items.append({
                'eid': eid,
                'aid': f'{workflow_id}_{segment_index:04d}_{qa_index:02d}',
                'conf': mention.get('confidence', 1.0),
                'ctx': mention.get('context', ''),
            })

    for start in range(0, len(mention_items), batch_size):
        batch = mention_items[start:start + batch_size]
        run_query(
            'UNWIND $items AS item '
            'MATCH (e:Entity {id: item.eid}), (a:Analysis {id: item.aid}) '
            'MERGE (e)-[r:MENTIONED_IN]->(a) '
            'SET r.confidence = item.conf, r.context = item.ctx',
            {'items': batch},
        )

    return {'success': True, 'created': len(entity_items)}


def action_add_relationships(params: dict) -> dict:
    """Add RELATES_TO relationships between entities."""
    project_id = params['project_id']
    relationships = params.get('relationships', [])

    items = [
        {
            'src': entity_id(project_id, rel['source'], rel.get('source_type', 'CONCEPT')),
            'tgt': entity_id(project_id, rel['target'], rel.get('target_type', 'CONCEPT')),
            'rel': rel.get('relationship', 'RELATED'),
            'origin': rel.get('source_origin', 'auto'),
        }
        for rel in relationships
    ]

    batch_size = 50
    for start in range(0, len(items), batch_size):
        batch = items[start:start + batch_size]
        run_query(
            'UNWIND $items AS item '
            'MATCH (a:Entity {id: item.src}), (b:Entity {id: item.tgt}) '
            'MERGE (a)-[r:RELATES_TO {relationship: item.rel}]->(b) '
            'SET r.source = item.origin',
            {'items': batch},
        )

    return {'success': True, 'created': len(items)}


def action_link_documents(params: dict) -> dict:
    """Create bidirectional RELATED_TO relationships between two Document nodes."""
    project_id = params['project_id']
    doc_id_1 = params['document_id_1']
    doc_id_2 = params['document_id_2']
    reason = params.get('reason', '')
    label = params.get('label', '')

    run_query(
        'MATCH (d1:Document {id: $d1, project_id: $pid}), '
        '      (d2:Document {id: $d2, project_id: $pid}) '
        'MERGE (d1)-[r:RELATED_TO]->(d2) '
        'SET r.reason = $reason, r.label = $label, r.created_at = datetime()',
        {'d1': doc_id_1, 'd2': doc_id_2, 'pid': project_id,
         'reason': reason, 'label': label},
    )
    run_query(
        'MATCH (d1:Document {id: $d1, project_id: $pid}), '
        '      (d2:Document {id: $d2, project_id: $pid}) '
        'MERGE (d2)-[r:RELATED_TO]->(d1) '
        'SET r.reason = $reason, r.label = $label, r.created_at = datetime()',
        {'d1': doc_id_1, 'd2': doc_id_2, 'pid': project_id,
         'reason': reason, 'label': label},
    )
    return {'success': True}


def action_unlink_documents(params: dict) -> dict:
    """Delete bidirectional RELATED_TO relationships between two Document nodes."""
    doc_id_1 = params['document_id_1']
    doc_id_2 = params['document_id_2']

    run_query(
        'MATCH (d1:Document {id: $d1})-[r:RELATED_TO]-(d2:Document {id: $d2}) DELETE r',
        {'d1': doc_id_1, 'd2': doc_id_2},
    )
    return {'success': True}


def action_get_linked_documents(params: dict) -> dict:
    """Get documents linked via RELATED_TO relationships."""
    project_id = params['project_id']
    doc_id = params.get('document_id')

    if doc_id:
        result = run_query(
            'MATCH (d1:Document {id: $did})-[r:RELATED_TO]->(d2:Document) '
            'RETURN d2.id AS id, d2.file_name AS file_name, '
            'r.reason AS reason, r.label AS label',
            {'did': doc_id},
        )
    else:
        result = run_query(
            'MATCH (d1:Document {project_id: $pid})-[r:RELATED_TO]->(d2:Document) '
            'WHERE d1.id < d2.id '
            'RETURN d1.id AS doc1, d1.file_name AS name1, '
            'd2.id AS doc2, d2.file_name AS name2, r.reason AS reason',
            {'pid': project_id},
        )
    return {'success': True, 'links': result}


def action_delete_analysis(params: dict) -> dict:
    """Delete a single Analysis node and its MENTIONED_IN edges, then clean up orphaned entities."""
    project_id = params['project_id']
    analysis_id = params['analysis_id']

    # Delete MENTIONED_IN edges pointing to this Analysis, then the Analysis node itself
    run_query(
        'MATCH (a:Analysis {id: $aid, project_id: $pid}) DETACH DELETE a',
        {'aid': analysis_id, 'pid': project_id},
    )

    # Clean up orphaned entities (no MENTIONED_IN or RELATES_TO connections)
    run_query(
        'MATCH (e:Entity {project_id: $pid}) '
        'WHERE NOT (e)-[:MENTIONED_IN]->() AND NOT (e)-[:RELATES_TO]-() '
        'AND NOT ()-[:RELATES_TO]->(e) '
        'DELETE e',
        {'pid': project_id},
    )

    return {'success': True, 'analysis_id': analysis_id}


def action_delete_by_workflow(params: dict) -> dict:
    """Delete all graph data for a workflow."""
    project_id = params['project_id']
    workflow_id = params['workflow_id']

    # Delete Analysis nodes first
    run_query(
        'MATCH (a:Analysis {project_id: $pid, workflow_id: $wid}) DETACH DELETE a',
        {'pid': project_id, 'wid': workflow_id},
    )

    run_query(
        'MATCH (s:Segment {project_id: $pid, workflow_id: $wid}) DETACH DELETE s',
        {'pid': project_id, 'wid': workflow_id},
    )

    run_query(
        'MATCH (d:Document {project_id: $pid, workflow_id: $wid}) DETACH DELETE d',
        {'pid': project_id, 'wid': workflow_id},
    )

    run_query(
        'MATCH (e:Entity {project_id: $pid}) '
        'WHERE NOT (e)-[:MENTIONED_IN]->() AND NOT (e)-[:RELATES_TO]-() '
        'AND NOT ()-[:RELATES_TO]->(e) '
        'DELETE e',
        {'pid': project_id},
    )

    return {'success': True}


# ========================================
# Read Actions
# ========================================

def action_traverse(params: dict) -> dict:
    """N-hop graph traversal from a starting node."""
    start_id = params['start_id']
    depth = params.get('depth', 2)
    limit = params.get('limit', 50)

    results = run_query(
        f'MATCH path = (start {{id: $sid}})-[*1..{depth}]-(connected) '
        'RETURN DISTINCT connected.id AS id, labels(connected) AS labels, '
        'properties(connected) AS props '
        f'LIMIT {int(limit)}',
        {'sid': start_id},
    )

    return {'success': True, 'nodes': results}


def action_find_related_segments(params: dict) -> dict:
    """Find Analysis nodes related to given entities via MENTIONED_IN, return segment info."""
    entity_ids = params.get('entity_ids', [])
    depth = params.get('depth', 2)
    limit = params.get('limit', 20)

    if not entity_ids:
        return {'success': True, 'segments': []}

    seen = set()
    all_segments = []

    for eid in entity_ids:
        results = run_query(
            'MATCH (e:Entity {id: $eid}) '
            'OPTIONAL MATCH (e)-[:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->(s:Segment) '
            f'OPTIONAL MATCH (e)-[:RELATES_TO*1..{depth}]-(related:Entity) '
            'OPTIONAL MATCH (related)-[:MENTIONED_IN]->(ra:Analysis)-[:BELONGS_TO]->(rs:Segment) '
            'WITH collect(DISTINCT s) + collect(DISTINCT rs) AS allSegs '
            'UNWIND allSegs AS seg '
            'WITH seg WHERE seg IS NOT NULL '
            'RETURN DISTINCT seg.id AS id, seg.workflow_id AS workflow_id, '
            'seg.document_id AS document_id, seg.segment_index AS segment_index '
            f'LIMIT {int(limit)}',
            {'eid': eid},
        )
        for r in results:
            if r.get('id') and r['id'] not in seen:
                seen.add(r['id'])
                all_segments.append(r)

    return {'success': True, 'segments': all_segments[:limit]}


def action_search_graph(params: dict) -> dict:
    """Graph traversal from QA IDs to discover related pages.

    Accepts qa_ids (from LanceDB search results) as starting points,
    then traverses: Analysis <-MENTIONED_IN- Entity -RELATES_TO- Entity
    -MENTIONED_IN-> Analysis -> Segment to find related pages.
    Falls back to entity name matching when qa_ids are not provided.
    """
    project_id = params['project_id']
    query = params.get('query', '')
    document_id = params.get('document_id')
    depth = params.get('depth', 2)
    entity_limit = params.get('entity_limit', 10)
    segment_limit = params.get('segment_limit', 20)
    # QA IDs from LanceDB results (format: wf_xxx_0001_00)
    qa_ids = params.get('qa_ids', [])

    # 1. Find starting entities from provided Analysis IDs or by name matching
    entity_results = []

    if qa_ids:
        # From LanceDB QA IDs, find entities connected via MENTIONED_IN -> Analysis
        entity_results = run_query(
            'UNWIND $qids AS qid '
            'MATCH (e:Entity)-[:MENTIONED_IN]->(a:Analysis {id: qid}) '
            'WHERE e.project_id = $pid '
            'RETURN DISTINCT e.id AS id, e.name AS name, e.type AS type '
            f'LIMIT {int(entity_limit)}',
            {'qids': qa_ids, 'pid': project_id},
        )
    if not entity_results:
        return {'success': True, 'entities': [], 'segments': []}

    # 2. From matched entities, traverse RELATES_TO to find related Analysis -> Segment
    # Convert qa_ids (wf_xxx_0001_00) to segment_ids (wf_xxx_0001) for dedup
    seen_seg_ids = set()
    for qid in qa_ids:
        parts = qid.rsplit('_', 1)
        if len(parts) == 2:
            seen_seg_ids.add(parts[0])
    traversal_segments = []

    # Collect document_ids from qa_ids for same-document filtering
    source_doc_ids = set()
    if qa_ids:
        doc_results = run_query(
            'UNWIND $qids AS qid '
            'MATCH (a:Analysis {id: qid})-[:BELONGS_TO]->(s:Segment) '
            'RETURN DISTINCT s.document_id AS document_id',
            {'qids': qa_ids},
        )
        source_doc_ids = {r['document_id'] for r in doc_results if r.get('document_id')}
    if document_id:
        source_doc_ids.add(document_id)

    # Build document filter clause
    doc_filter = ''
    query_params_extra = {}
    if source_doc_ids:
        doc_filter = 'AND seg.document_id IN $doc_ids '
        query_params_extra['doc_ids'] = list(source_doc_ids)

    entity_ids = [e['id'] for e in entity_results]
    for eid in entity_ids:
        results = run_query(
            'MATCH (e:Entity {id: $eid}) '
            'OPTIONAL MATCH (e)-[:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->(s:Segment) '
            f'OPTIONAL MATCH (e)-[:RELATES_TO*1..{int(depth)}]-(related:Entity) '
            'OPTIONAL MATCH (related)-[:MENTIONED_IN]->(ra:Analysis)-[:BELONGS_TO]->(rs:Segment) '
            'WITH collect(DISTINCT s) + collect(DISTINCT rs) AS allSegs '
            'UNWIND allSegs AS seg '
            f'WITH seg WHERE seg IS NOT NULL {doc_filter}'
            'RETURN DISTINCT seg.id AS id, seg.workflow_id AS workflow_id, '
            'seg.document_id AS document_id, seg.segment_index AS segment_index '
            f'LIMIT {int(segment_limit)}',
            {'eid': eid, **query_params_extra},
        )
        for r in results:
            if r.get('id') and r['id'] not in seen_seg_ids:
                seen_seg_ids.add(r['id'])
                traversal_segments.append(r)

    # 3. Build result segments
    all_segments = []
    for s in traversal_segments:
        seg = {
            'id': s['id'],
            'workflow_id': s['workflow_id'],
            'document_id': s['document_id'],
            'segment_index': s['segment_index'],
            'match_type': 'traversal',
        }
        if not document_id or seg['document_id'] == document_id:
            all_segments.append(seg)

    return {
        'success': True,
        'entities': entity_results,
        'segments': all_segments[:segment_limit],
    }


def action_get_entity_graph(params: dict) -> dict:
    """Get project-level entity graph for visualization."""
    project_id = params['project_id']

    entity_results, rel_results, doc_results, entity_doc_results = run_queries_parallel([
        (
            'MATCH (e:Entity {project_id: $pid}) '
            'RETURN e.id AS id, e.name AS name, e.type AS type',
            {'pid': project_id},
        ),
        (
            'MATCH (a:Entity {project_id: $pid})-[r:RELATES_TO]->(b:Entity {project_id: $pid}) '
            'RETURN a.id AS source, b.id AS target, r.relationship AS label, '
            'r.source AS origin',
            {'pid': project_id},
        ),
        (
            'MATCH (d:Document {project_id: $pid}) '
            'RETURN d.id AS id, d.file_name AS file_name, d.file_type AS file_type',
            {'pid': project_id},
        ),
        (
            'MATCH (e:Entity {project_id: $pid})-[:MENTIONED_IN]->(:Analysis)'
            '-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(d:Document) '
            'RETURN DISTINCT e.id AS entity_id, d.id AS document_id',
            {'pid': project_id},
        ),
    ])

    nodes = [
        {
            'id': e['id'],
            'label': e['name'],
            'type': 'entity',
            'properties': {'entity_type': e['type']},
        }
        for e in entity_results
    ]

    for d in doc_results:
        nodes.append({
            'id': d['id'],
            'label': d.get('file_name', d['id']),
            'type': 'document',
            'properties': {'file_type': d.get('file_type', '')},
        })

    edges = [
        {
            'source': r['source'],
            'target': r['target'],
            'label': r['label'],
            'properties': {'origin': r.get('origin', 'auto')},
        }
        for r in rel_results
    ]

    for ed in entity_doc_results:
        edges.append({
            'source': ed['entity_id'],
            'target': ed['document_id'],
            'label': 'APPEARS_IN',
            'properties': None,
        })

    return {'success': True, 'nodes': nodes, 'edges': edges}


CLUSTER_THRESHOLD = 500


def _build_document_graph_full(project_id, document_id, params_both,
                               seg_results, analysis_results, next_results):
    """Build full document graph with individual entities."""
    ent_results, mention_results, rel_results = run_queries_parallel([
        (
            'MATCH (e:Entity)-[:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN DISTINCT e.id AS id, e.name AS name, e.type AS type',
            params_both,
        ),
        (
            'MATCH (e:Entity)-[r:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN e.id AS source, a.id AS target, '
            'r.confidence AS confidence, r.context AS context',
            params_both,
        ),
        (
            'MATCH (a_ent:Entity)-[r:RELATES_TO]->(b_ent:Entity) '
            'WHERE (a_ent)-[:MENTIONED_IN]->(:Analysis)-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(:Document {id: $did}) '
            'AND (b_ent)-[:MENTIONED_IN]->(:Analysis)-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(:Document {id: $did}) '
            'RETURN a_ent.id AS source, b_ent.id AS target, r.relationship AS label',
            {'did': document_id},
        ),
    ])

    nodes, edges = _build_structure_nodes_edges(
        document_id, seg_results, analysis_results, next_results
    )

    for e in ent_results:
        nodes.append({
            'id': e['id'],
            'label': e['name'],
            'type': 'entity',
            'properties': {'entity_type': e['type']},
        })

    for m in mention_results:
        edges.append({
            'source': m['source'],
            'target': m['target'],
            'label': 'MENTIONED_IN',
            'properties': {
                'confidence': m.get('confidence', 1.0),
                'context': m.get('context', ''),
            },
        })

    for r in rel_results:
        edges.append({
            'source': r['source'],
            'target': r['target'],
            'label': r['label'],
            'properties': None,
        })

    return nodes, edges


def _build_document_graph_clustered(project_id, document_id, params_both,
                                    seg_results, analysis_results, next_results):
    """Build clustered document graph: entities grouped by type."""
    # Get entity type counts + sample names + cluster-to-analysis edges
    cluster_results, cluster_edge_results, rel_cluster_results = run_queries_parallel([
        (
            'MATCH (e:Entity)-[:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'WITH e.type AS etype, count(DISTINCT e) AS cnt, '
            'collect(DISTINCT e.name)[..5] AS samples '
            'RETURN etype, cnt, samples',
            params_both,
        ),
        (
            'MATCH (e:Entity)-[r:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN e.type AS etype, a.id AS analysis_id, count(*) AS mention_count',
            params_both,
        ),
        (
            'MATCH (a_ent:Entity)-[r:RELATES_TO]->(b_ent:Entity) '
            'WHERE (a_ent)-[:MENTIONED_IN]->(:Analysis)-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(:Document {id: $did}) '
            'AND (b_ent)-[:MENTIONED_IN]->(:Analysis)-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(:Document {id: $did}) '
            'RETURN a_ent.type AS source_type, b_ent.type AS target_type, count(*) AS rel_count',
            {'did': document_id},
        ),
    ])

    nodes, edges = _build_structure_nodes_edges(
        document_id, seg_results, analysis_results, next_results
    )

    # Add cluster nodes
    for c in cluster_results:
        etype = c['etype']
        cluster_id = f'cluster_{etype}'
        nodes.append({
            'id': cluster_id,
            'label': f"{etype} ({c['cnt']})",
            'type': 'cluster',
            'properties': {
                'entity_type': etype,
                'count': c['cnt'],
                'samples': c['samples'],
            },
        })

    # Add cluster -> analysis edges (aggregated)
    seen_cluster_edges = set()
    for ce in cluster_edge_results:
        cluster_id = f"cluster_{ce['etype']}"
        analysis_id = ce['analysis_id']
        edge_key = f'{cluster_id}:{analysis_id}'
        if edge_key not in seen_cluster_edges:
            seen_cluster_edges.add(edge_key)
            edges.append({
                'source': cluster_id,
                'target': analysis_id,
                'label': 'MENTIONED_IN',
                'properties': {'count': ce['mention_count']},
            })

    # Add cluster -> cluster edges (aggregated RELATES_TO)
    seen_rel = set()
    for rc in rel_cluster_results:
        src = f"cluster_{rc['source_type']}"
        tgt = f"cluster_{rc['target_type']}"
        if src == tgt:
            continue
        edge_key = f'{src}:{tgt}'
        if edge_key not in seen_rel:
            seen_rel.add(edge_key)
            edges.append({
                'source': src,
                'target': tgt,
                'label': 'RELATES_TO',
                'properties': {'count': rc['rel_count']},
            })

    return nodes, edges


def _build_structure_nodes_edges(document_id, seg_results, analysis_results, next_results):
    """Build structural nodes (document, segments, analyses) and edges."""
    nodes = []

    doc_file_name = document_id
    if seg_results:
        doc_file_name = seg_results[0].get('doc_file_name') or document_id

    nodes.append({
        'id': document_id,
        'label': doc_file_name,
        'type': 'document',
        'properties': {},
    })

    for s in seg_results:
        nodes.append({
            'id': s['id'],
            'label': f"Page {s['segment_index']}",
            'type': 'segment',
            'properties': {
                'segment_index': s['segment_index'],
                'workflow_id': s['workflow_id'],
            },
        })

    for a in analysis_results:
        nodes.append({
            'id': a['id'],
            'label': f"QA {a.get('qa_index', 0) + 1}",
            'type': 'analysis',
            'properties': {
                'segment_index': a['segment_index'],
                'qa_index': a.get('qa_index', 0),
                'question': a.get('question', ''),
            },
        })

    edges = []

    for n in next_results:
        edges.append({
            'source': n['source'],
            'target': n['target'],
            'label': 'NEXT',
            'properties': None,
        })

    for a in analysis_results:
        edges.append({
            'source': a['id'],
            'target': a['segment_id'],
            'label': 'BELONGS_TO',
            'properties': None,
        })

    for s in seg_results:
        edges.append({
            'source': s['id'],
            'target': document_id,
            'label': 'BELONGS_TO',
            'properties': None,
        })

    return nodes, edges


def action_get_document_graph(params: dict) -> dict:
    """Get document-level graph (segments + analyses + entities) for visualization.

    Auto-clusters entities by type when entity count exceeds CLUSTER_THRESHOLD.
    """
    project_id = params['project_id']
    document_id = params['document_id']

    params_both = {'did': document_id, 'pid': project_id}

    # Parallel: structural queries + entity count
    seg_results, analysis_results, next_results, count_results = run_queries_parallel([
        (
            'MATCH (s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN s.id AS id, s.segment_index AS segment_index, '
            's.workflow_id AS workflow_id, d.file_name AS doc_file_name '
            'ORDER BY s.segment_index',
            params_both,
        ),
        (
            'MATCH (a:Analysis)-[:BELONGS_TO]->(s:Segment)-[:BELONGS_TO]->'
            '(d:Document {id: $did, project_id: $pid}) '
            'RETURN a.id AS id, a.segment_index AS segment_index, '
            'a.qa_index AS qa_index, a.question AS question, s.id AS segment_id',
            params_both,
        ),
        (
            'MATCH (a:Segment)-[:NEXT]->(b:Segment) '
            'WHERE a.document_id = $did AND b.document_id = $did '
            'RETURN a.id AS source, b.id AS target',
            {'did': document_id},
        ),
        (
            'MATCH (e:Entity)-[:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN count(DISTINCT e) AS cnt',
            params_both,
        ),
    ])

    entity_count = count_results[0]['cnt'] if count_results else 0
    clustered = entity_count > CLUSTER_THRESHOLD
    print(f'Document graph: {entity_count} entities, clustered={clustered}')

    if clustered:
        nodes, edges = _build_document_graph_clustered(
            project_id, document_id, params_both,
            seg_results, analysis_results, next_results,
        )
    else:
        nodes, edges = _build_document_graph_full(
            project_id, document_id, params_both,
            seg_results, analysis_results, next_results,
        )

    return {'success': True, 'nodes': nodes, 'edges': edges, 'clustered': clustered}


def action_expand_entity_cluster(params: dict) -> dict:
    """Expand a clustered entity type into individual entities for a document."""
    project_id = params['project_id']
    document_id = params['document_id']
    entity_type = params['entity_type']

    params_q = {'did': document_id, 'pid': project_id, 'etype': entity_type}

    ent_results, mention_results, rel_results = run_queries_parallel([
        (
            'MATCH (e:Entity {type: $etype})-[:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN DISTINCT e.id AS id, e.name AS name, e.type AS type',
            params_q,
        ),
        (
            'MATCH (e:Entity {type: $etype})-[r:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
            '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
            'RETURN e.id AS source, a.id AS target, '
            'r.confidence AS confidence, r.context AS context',
            params_q,
        ),
        (
            'MATCH (a_ent:Entity {type: $etype})-[r:RELATES_TO]->(b_ent:Entity) '
            'WHERE (a_ent)-[:MENTIONED_IN]->(:Analysis)-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(:Document {id: $did}) '
            'AND (b_ent)-[:MENTIONED_IN]->(:Analysis)-[:BELONGS_TO]->(:Segment)-[:BELONGS_TO]->(:Document {id: $did}) '
            'RETURN a_ent.id AS source, b_ent.id AS target, r.relationship AS label',
            {'did': document_id, 'etype': entity_type},
        ),
    ])

    nodes = []
    for e in ent_results:
        nodes.append({
            'id': e['id'],
            'label': e['name'],
            'type': 'entity',
            'properties': {'entity_type': e['type']},
        })

    edges = []
    for m in mention_results:
        edges.append({
            'source': m['source'],
            'target': m['target'],
            'label': 'MENTIONED_IN',
            'properties': {
                'confidence': m.get('confidence', 1.0),
                'context': m.get('context', ''),
            },
        })

    for r in rel_results:
        edges.append({
            'source': r['source'],
            'target': r['target'],
            'label': r['label'],
            'properties': None,
        })

    return {'success': True, 'nodes': nodes, 'edges': edges, 'entity_type': entity_type}


def action_get_document_tagcloud(params: dict) -> dict:
    """Get lightweight entity tag cloud data for a document.

    Returns entity name, type, and connection count without full graph structure.
    """
    project_id = params['project_id']
    document_id = params['document_id']

    results = run_query(
        'MATCH (e:Entity)-[r:MENTIONED_IN]->(a:Analysis)-[:BELONGS_TO]->'
        '(s:Segment)-[:BELONGS_TO]->(d:Document {id: $did, project_id: $pid}) '
        'WITH e, count(r) AS mentions '
        'OPTIONAL MATCH (e)-[rel:RELATES_TO]-() '
        'RETURN e.id AS id, e.name AS name, e.type AS type, '
        'mentions + count(rel) AS connections',
        {'did': document_id, 'pid': project_id},
    )

    tags = [
        {
            'id': r['id'],
            'name': r['name'],
            'type': r['type'],
            'connections': r['connections'],
        }
        for r in results
    ]

    return {'success': True, 'tags': tags}



# ========================================
# Handler
# ========================================

def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    action = event.get('action')
    params = event.get('params', {})
    print(f'Action: {action}')

    actions = {
        # Write
        'add_segment_links': action_add_segment_links,
        'add_analyses': action_add_analyses,
        'add_entities': action_add_entities,
        'add_relationships': action_add_relationships,
        'link_documents': action_link_documents,
        'unlink_documents': action_unlink_documents,
        'get_linked_documents': action_get_linked_documents,
        'delete_analysis': action_delete_analysis,
        'delete_by_workflow': action_delete_by_workflow,
        # Read
        'search_graph': action_search_graph,
        'traverse': action_traverse,
        'find_related_segments': action_find_related_segments,
        'get_entity_graph': action_get_entity_graph,
        'get_document_graph': action_get_document_graph,
        'expand_entity_cluster': action_expand_entity_cluster,
        'get_document_tagcloud': action_get_document_tagcloud,
    }

    if action not in actions:
        print(f'Unknown action: {action}')
        return {
            'statusCode': 400,
            'error': f'Unknown action: {action}',
        }

    try:
        print(f'Executing action: {action}')
        result = actions[action](params)
        print(f'Action result keys: {list(result.keys())}')
        return {
            'statusCode': 200,
            **result,
        }
    except Exception as e:
        print(f'Error in action {action}: {e}')
        return {
            'statusCode': 500,
            'error': str(e),
        }
