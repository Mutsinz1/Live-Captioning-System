# Contributing

Thanks for your interest in improving the Live Captioning System!

## Development setup

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt pytest
python main.py
```

Frontend:

```bash
cd frontend
npm install
npm start
```

You'll need a Vosk model in `backend/models/` — see the README for download
links.

## Running tests

```bash
cd backend
pytest tests/ -v
```

The tests stub the Vosk engine, so they run without models or downloads.

## Guidelines

- Python follows PEP 8; JavaScript follows the ESLint configuration.
- Use conventional commit messages where practical.
- Add or update tests for any backend behavior change.
- Open an issue first for large changes so we can discuss the approach.
