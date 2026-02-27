# 🚀 Weby: Your Private, Local-First Web AI Sidekick

**Weby** is a revolutionary browser extension that brings the power of Large Language Models (LLMs) directly into your browser—**100% locally**. No API keys, no subscriptions, and total privacy. Weby indexes the pages you visit in real-time, allowing you to chat with your web content, summarize articles, and extract insights without your data ever leaving your machine.

![Weby Logo](public/inledai.svg)

---

## ✨ Key Features

- **🔒 100% Local Privacy:** Everything runs on your hardware. No data is sent to external servers or AI providers.
- **🧠 Intelligent Web RAG:** High-performance Retrieval-Augmented Generation (RAG) that understands the specific context of the website you are currently viewing.
- **🔄 Tab-Synced Conversations:** Switch tabs, and Weby automatically brings up the last conversation you had for that specific URL.
- **⚡ Supercharged Sidebar:** A sleek, ChatGPT-like interface that lives in your browser's side panel for instant access.
- **🌐 Web Research Mode:** Need more info? Weby can search the web locally to supplement its knowledge.
- **🛠️ MCP Integration:** Connect to Model Context Protocol (MCP) servers like Notion, Google Drive, or local tools to extend your AI's capabilities.
- **🎙️ Voice Mode:** Talk to your web content and hear responses back with built-in Speech-to-Text and Text-to-Speech.

---

## 🛠️ Installation (Developer Mode)

Since Weby runs high-performance WASM and WebGPU models locally, it is currently distributed as a developer-mode extension for maximum performance.

1. **Download the Latest Build:** Go to the [Releases](https://github.com/InledGroup/Weby-edgeai) page and download `weby-extension.zip`.
2. **Unzip the File:** Extract the contents to a folder on your computer.
3. **Open Extensions Page:** In Chrome (or any Chromium browser), go to `chrome://extensions`.
4. **Enable Developer Mode:** Toggle the switch in the top right corner.
5. **Load Unpacked:** Click the "Load unpacked" button and select the folder you just extracted (the one containing `manifest.json`).
6. **Start Chatting:** Open the side panel by clicking the Weby icon and start chatting!

---

## 🚀 How it Works

Weby uses a sophisticated local pipeline to provide high-quality AI responses:

1. **Extraction:** It uses `Turndown` to convert the active tab's HTML into clean Markdown.
2. **Indexing:** A local embedding model (via `Wllama` or `WebLLM`) chunks and vectors the text into an IndexedDB.
3. **Retrieval:** When you ask a question, Weby performs a hybrid semantic search to find the most relevant parts of the page.
4. **Generation:** A local LLM (like Qwen 3 0.5B or - Llama 3.2 1B) processes the context and generates an answer right in your browser.

---

## 🔧 Technology Stack

- **Frontend:** Preact + Tailwind CSS
- **Local AI Engines:** WebLLM (WebGPU) & Wllama (WASM)
- **Database:** IndexedDB (via `idb`)
- **Communication:** Chrome Extension Bridge
- **Workflow:** Automated CI/CD via GitHub Actions

---

## 🤝 Contributing

We welcome contributions! Whether it's reporting a bug, suggesting a feature, or submitting a pull request, your help makes Weby better for everyone.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License

Distributed under the GNU GPLv3.0 License. See `LICENSE` for more information.

---

<p align="center">
  Built with ❤️ by <b>Inled Group</b>
</p>
