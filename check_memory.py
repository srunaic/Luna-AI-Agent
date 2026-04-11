import sqlite3
conn = sqlite3.connect("d:/LunaProject/luna-server/chroma_db/chroma.sqlite3")
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
print("Tables:", [r[0] for r in cur.fetchall()])
try:
    cur.execute("SELECT COUNT(*) FROM embeddings")
    print("Total memories:", cur.fetchone()[0])
except:
    cur.execute("SELECT COUNT(*) FROM embedding_metadata")
    print("Total memories (metadata):", cur.fetchone()[0])
conn.close()
