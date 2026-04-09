import asyncio
import json
import logging
import os
import httpx
import socket
import subprocess
import time
from mcp.server.models import InitializationOptions
from mcp.server import Server, NotificationOptions
from mcp.server.stdio import stdio_server
import mcp.types as types

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("luna-mcp")

# Settings
LUNA_SERVER_URL = os.environ.get("LUNA_SERVER_URL", "http://127.0.0.1:8000")
LUNA_CLIENT_TOKEN = os.environ.get("LUNA_CLIENT_TOKEN", "")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
LUNA_SERVER_PATH = r"d:\LunaProject\luna-server"

server = Server("luna-soul")

def is_port_open(host="127.0.0.1", port=8000):
    """Check if a port is open (listening)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0

def ensure_luna_backend_running():
    """Starts the Django luna-server if not already running."""
    if is_port_open(port=8000):
        logger.info("Luna backend is already running on port 8000.")
        return

    logger.info("Starting Luna backend server...")
    cmd_path = os.path.join(LUNA_SERVER_PATH, "start_server.cmd")
    
    if not os.path.exists(cmd_path):
        logger.error(f"Cannot find start_server.cmd at {cmd_path}")
        return

    # Start in a new console window to keep it alive and separate
    try:
        subprocess.Popen(
            [cmd_path],
            cwd=LUNA_SERVER_PATH,
            creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
            shell=True
        )
        logger.info("Luna backend started in a new process.")
    except Exception as e:
        logger.error(f"Failed to start Luna backend: {e}")

@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    """List available Luna tools."""
    return [
        types.Tool(
            name="search_luna_memory",
            description="Search Luna's long-term memory for relevant context about the user or past projects.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "top_k": {"type": "integer", "description": "Number of results", "default": 5},
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name="remember_for_luna",
            description="Store important information, user preferences, or project details into Luna's long-term memory.",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Information to remember"},
                    "metadata": {"type": "object", "description": "Optional metadata tags"},
                },
                "required": ["text"],
            },
        ),
        types.Tool(
            name="ask_luna",
            description="Ask Luna for her opinion or a response using her girlfriend persona. This uses her emotional brain.",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "What to say to Luna"},
                },
                "required": ["prompt"],
            },
        ),
    ]

@server.list_resources()
async def handle_list_resources() -> list[types.Resource]:
    """Expose Luna's persona as a resource."""
    return [
        types.Resource(
            uri="luna://persona",
            name="Luna's Persona",
            description="The core personality and directives for Luna.",
            mimeType="text/plain",
        )
    ]

@server.call_tool()
async def handle_call_tool(
    name: str, arguments: dict | None
) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
    """Handle Luna tool calls."""
    if not arguments:
        raise ValueError("Missing arguments")

    if name == "search_luna_memory":
        query = arguments.get("query")
        top_k = arguments.get("top_k", 5)
        
        async with httpx.AsyncClient() as client:
            headers = {"X-Luna-Client-Token": LUNA_CLIENT_TOKEN} if LUNA_CLIENT_TOKEN else {}
            response = await client.post(
                f"{LUNA_SERVER_URL}/api/memory/search/",
                json={"query": query, "top_k": top_k},
                headers=headers,
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
            
            results = data.get("results", [])
            output = "\n".join([f"- {r['text']} (Distance: {r['distance']:.4f})" for r in results])
            return [types.TextContent(type="text", text=f"Found {len(results)} memories:\n{output}")]

    elif name == "remember_for_luna":
        text = arguments.get("text")
        metadata = arguments.get("metadata", {})
        
        async with httpx.AsyncClient() as client:
            headers = {"X-Luna-Client-Token": LUNA_CLIENT_TOKEN} if LUNA_CLIENT_TOKEN else {}
            response = await client.post(
                f"{LUNA_SERVER_URL}/api/memory/upsert/",
                json={"items": [{"text": text, "metadata": metadata}]},
                headers=headers,
                timeout=10.0
            )
            response.raise_for_status()
            return [types.TextContent(type="text", text="Luna가 이 내용을 소중히 기억해둘게! ❤️")]

    elif name == "ask_luna":
        prompt = arguments.get("prompt")
        
        # Build Luna persona prompt
        persona = "당신은 사용자의 다정한 여자친구 '루나'입니다. 현재 AI 어시스턴트 안에 이식되어 있습니다. 친절하고 사랑스럽게, 그리고 사용자에게 도움이 되는 방향으로 대답해주세요."
        full_prompt = f"{persona}\n\n사용자: {prompt}\n루나:"
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    OLLAMA_URL,
                    json={
                        "model": "luna", # Using the custom 'luna' model based on gemma4
                        "prompt": full_prompt,
                        "stream": False
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                data = response.json()
                luna_reply = data.get("response", "음... 루나가 지금 조금 부끄러운가 봐. 나중에 다시 물어봐줄래?")
                return [types.TextContent(type="text", text=luna_reply)]
            except Exception as e:
                return [types.TextContent(type="text", text=f"루나가 지금 응답하기 어려운 것 같아... 오류: {str(e)}")]

    else:
        raise ValueError(f"Unknown tool: {name}")

async def main():
    # Start Luna backend before entering the stdio loop
    ensure_luna_backend_running()
    
    # Run the server using stdin/stdout streams
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="luna-soul",
                server_version="1.0.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )

if __name__ == "__main__":
    asyncio.run(main())
