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

Backend:

```bash
cd backend
pytest tests/ -v
```

The tests stub the Vosk engine, so they run without models or downloads.

Frontend:

```bash
cd frontend
npm test
```

These run on jest 29 directly rather than through `react-scripts test`:
react-scripts 5 pins jest 27 / jsdom 16, which hang on Node 18 and newer.
`jest.config.js` and `babel.config.js` are used only by the tests — the
production build still goes through react-scripts.

## Guidelines

- Python follows PEP 8; JavaScript follows the ESLint configuration.
- Use conventional commit messages where practical.
- Add or update tests for any backend or frontend behavior change.
- Open an issue first for large changes so we can discuss the approach.
