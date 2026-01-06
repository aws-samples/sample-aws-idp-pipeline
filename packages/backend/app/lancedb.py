from functools import lru_cache

import lancedb

from app.config import get_config


@lru_cache
def get_db() -> lancedb.DBConnection:
    config = get_config()
    return lancedb.connect(
        f"s3+ddb://{config.lancedb_express_bucket_name}?ddbTableName={config.lancedb_lock_table_name}"
    )
