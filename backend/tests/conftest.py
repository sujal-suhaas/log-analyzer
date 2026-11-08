import sys
from pathlib import Path

# The app modules (main, datasets, generate_logs) live one level up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
