## ZeroEntropy SDK Helper

### Description
ZeroEntropy is a state-of-the-art retrieval API for documents, pages, snippets, and reranking. It provides low-latency, high-accuracy search over your private corpus via a simple SDK.

Install:
- Python: `pip install zeroentropy`
- Node.js: `npm install zeroentropy`

### Client Usage (Python)

```python
from zeroentropy import ZeroEntropy
client = ZeroEntropy(api_key="your_api_key")
```

Auth & Configuration:
- ENV VARS read by SDK: `ZEROENTROPY_API_KEY`
- Missing key triggers authentication error on instantiation.

Instantiate (async):

```python
from dotenv import load_dotenv
load_dotenv()
from zeroentropy import AsyncZeroEntropy, ConflictError, HTTPStatusError
zclient = AsyncZeroEntropy()  # picks up ENV VARS
```

### SDK Structure
All methods are async, grouped under:
- `zclient.collections`
- `zclient.documents`
- `zclient.status`
- `zclient.queries`
- `zclient.models`

Each method returns structured responses defined by `pydantic.BaseModel`.

### Collections
- `zclient.collections.add(collection_name: str) -> None`
  - Always specify a collection name, e.g., `zclient.collections.add(collection_name="my_collection")`.
  - If the collection already exists, it will throw a conflict error; check existence or catch errors.
- `zclient.collections.get_list() -> List[str]`
- `zclient.collections.delete(collection_name: str) -> None`

### Documents
- `zclient.documents.add(collection_name: str, path: str, content, metadata: dict = None, overwrite: bool = False) -> None`
  - The add method handles parsing for PDFs, etc.
  - `content` accepts:
    - `{"type":"auto", "base64_data":"..."}` for PDFs and auto-parsing
    - `{"type":"text", "text":"..."}` for text
    - `{"type":"text-pages", "pages":["page1", "page2"]}` for per-page text
  - If the document exists, it will throw a conflict; check or catch errors.
- `zclient.documents.get_info(collection_name: str, path: str, include_content: bool = False) -> DocumentResponse`
- `zclient.documents.get_info_list(collection_name: str, limit: int = 1024, id_gt: Optional[str] = None) -> List[DocumentMetadataResponse]`
- `zclient.documents.update(collection_name: str, path: str, metadata: Optional[dict]) -> UpdateDocumentResponse`
- `zclient.documents.delete(collection_name: str, path: str) -> None`

### Queries
- `zclient.queries.top_documents(collection_name: str, query: str, k: int, filter: Optional[dict] = None, include_metadata: bool = False, latency_mode: str = "low") -> List[DocumentRetrievalResponse]`
- `zclient.queries.top_pages(collection_name: str, query: str, k: int, filter: Optional[dict] = None, include_content: bool = False, latency_mode: str = "low") -> List[PageRetrievalResponse]`
- `zclient.queries.top_snippets(collection_name: str, query: str, k: int, filter: Optional[dict] = None, precise_responses: bool = False) -> List[SnippetResponse]`

### Status
- `zclient.status.get(collection_name: Optional[str] = None) -> StatusResponse`

### Parsers
- `zclient.parsers.parse_document(base64_data: str) -> ParseDocumentResponse`

### Models
- `zclient.models.rerank(query: str, documents: list[str], model: str, top_n: int) -> RerankResult`

### Common Patterns

1) Collections

```python
try:
    await zclient.collections.add(collection_name="my_col")
except ConflictError:
    pass
names = (await zclient.collections.get_list()).collection_names
await zclient.collections.delete(collection_name="my_col")
```

2) Documents

```python
# Add text
await zclient.documents.add(
    collection_name="col",
    path="doc.txt",
    content={"type":"text","text":text},
    metadata={"source":"notes"},
)

# Add PDF via OCR
import base64
b64 = base64.b64encode(open(path,"rb").read()).decode()
await zclient.documents.add(
    collection_name="col",
    path="doc.pdf",
    content={"type":"auto","base64_data":b64},
    metadata={"type":"pdf"},
)

# Add CSV lines
for i, line in enumerate(open(path).read().splitlines()):
    await zclient.documents.add(
        collection_name="col",
        path=f"{path}_{i}",
        content={"type":"text","text":line},
        metadata={"type":"csv"},
    )

# Delete
await zclient.documents.delete(collection_name="col", path="doc.txt")

# Get info (with optional content)
info = await zclient.documents.get_info(
    collection_name="col",
    path="doc.txt",
    include_content=True,
)
```

3) Update & Pagination

```python
# Update metadata or force re-index
await zclient.documents.update(
    collection_name="col",
    path="doc.txt",
    metadata={"reviewed":"yes"},
)

# List documents with pagination
resp = await zclient.documents.get_info_list(
    collection_name="col",
    limit=100,
    id_gt="doc_009.txt",
)
for doc in resp.documents:
    print(doc.path, doc.index_status)

# Per-page info
page = await zclient.documents.get_info(
    collection_name="col",
    path="doc.pdf",
    include_content=True,
)
```

4) Pure Parsing (OCR helper)

```python
pages = await zclient.parsers.parse_document(
    base64_data=b64
)
# returns list of page strings without indexing
```

5) Status (overall or per-collection)

```python
status_all = await zclient.status.get()
status_col = await zclient.status.get(collection_name="col")
```

6) Queries

```python
# Top K documents (k≤2048), with filter, reranker, latency_mode
docs = await zclient.queries.top_documents(
    collection_name="col",
    query="find insight",
    k=5,
    filter={"type":{"$ne":"csv"}},
    include_metadata=True,
)

# Top K pages (k≤1024), include_content, latency_mode
pages = await zclient.queries.top_pages(
    collection_name="col",
    query="overview",
    k=3,
    include_content=True,
)

# Top K snippets (k≤128), precise or coarse
snips = await zclient.queries.top_snippets(
    collection_name="col",
    query="key method",
    k=5,
    precise_responses=True,
)
```

### Expected Response Models (Python type hints)

1) DocumentResponse (used in `get_info`)

```python
class DocumentResponse(BaseModel):
    id: str
    collection_name: str
    path: str
    metadata: Dict[str, str]
    index_status: str  # "parsing_failed" | "not_parsed" | "parsing" | "not_indexed" | "indexing" | "indexed"
    num_pages: Optional[int] = None
    content: Optional[str] = None
```

2) UpdateDocumentResponse (used in `update`)

```python
class UpdateDocumentResponse(BaseModel):
    previous_id: str
    new_id: str
```

3) DocumentRetrievalResponse (used in `top_documents`)

```python
class DocumentRetrievalResponse(BaseModel):
    results: List[Response]
class Response(BaseModel):
    path: str
    metadata: Optional[Dict[str, str]] = None
    score: float
```

4) PageRetrievalResponse (used in `top_pages`)

```python
class PageRetrievalResponse(BaseModel):
    results: List[Response]
class Response(BaseModel):
    path: str
    page_index: int
    score: float
    content: Optional[str] = None
```

5) SnippetResponse (used in `top_snippets`)

```python
class SnippetResponse(BaseModel):
    results: List[Response]
class Response(BaseModel):
    path: str
    start_index: int
    end_index: int
    page_span: List[int]
    content: Optional[str] = None
    score: float
```

6) StatusResponse (used in `status.get`)

```python
class StatusResponse(BaseModel):
    num_documents: int
    num_parsing_documents: int
    num_indexing_documents: int
    num_indexed_documents: int
    num_failed_documents: int
```

7) ParseDocumentResponse (used in `parse_document`)

```python
class ParseDocumentResponse(BaseModel):
    pages: List[str]
```

8) RerankResponse (used in `models.rerank`)

```python
class RerankResult(BaseModel):
    index: int
    relevance_score: float
```

### Additional Notes
- LLM should always use these BaseModels when generating SDK-based responses.
- Metadata Filtering
  - Document metadata is `dict[str, str | list[str]]`.
  - Filters support operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`.
- Responses match these structures unless otherwise stated.
- Always include imports and `load_dotenv()`.
- Use proper `async/await` structure with `asyncio.run()` when scripting.
- Override `base_url` when targeting EU cluster if needed.
- Wrap calls in `try/except` to handle `ConflictError` and `HTTPStatusError`.

### Complete Async Example

```python
import asyncio
from dotenv import load_dotenv
from zeroentropy import AsyncZeroEntropy, ConflictError, HTTPStatusError
import base64

load_dotenv()
zclient = AsyncZeroEntropy()

async def main():
    try:
        await zclient.collections.add("my_col")
    except ConflictError:
        pass

    text = "Hello ZeroEntropy"
    await zclient.documents.add(
        collection_name="my_col",
        path="hello.txt",
        content={"type":"text","text":text},
        metadata={"lang":"en"},
    )

    status = await zclient.status.get("my_col")
    print("Indexed:", status.num_indexed_documents)

    docs = await zclient.queries.top_documents(
        collection_name="my_col",
        query="Hello",
        k=1,
        include_metadata=True,
    )
    print(docs.results)

if __name__ == "__main__":
    asyncio.run(main())
```


