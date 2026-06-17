
# Technical Assessment — AI Automation Executive
> Submission Deadline: 2 days from receipt of this document, June 19th, 10:00 pm
Submission: GitHub repository public + Architecture & Design Document

---

## Role details
- Role: AI Automation Executive (Full-time)
- Company: Repeatless (repeatless.in)
- CTC: 4.5-6 LPA (Based on performance)
- Location: Hybrid
- Hiring urgency: Immediate
- Openings: 2
Candidate should be Versatile and able to learn new tools quickly. Have Strong problem-solving and delivery mindset. Comfortable owning tasks end-to-end and producing clear outcomes.

## Overview
You are required to design and build an AI-powered Gmail Intelligence Platform — a web application that connects to a user's Gmail account, processes their emails intelligently, and provides an AI-driven assistant experience to interact with, manage, and act on email data.
This assessment evaluates your ability to architect and build real-world AI automation systems — the core of what you will do in this role. We are looking at how you think, how you structure systems, how you leverage AI, and the quality of decisions you make across the stack.
> You are free to use additional libraries, tools, or services where appropriate.
- N8N
- Claude, Codex, Github Copilot… any AI
- Other tools

---
**▸ Objective**
  Build a web application with the following capabilities:
  1. Gmail Integration — Securely connect to a Gmail account and sync email data
  1. Email Summarization — Automatically summarize individual emails and threads
  1. Compose & Reply — Draft and send emails from short prompts
  1. Thread-Aware Replies — Reply to emails with full thread context preserved
  1. Email Categorization — Automatically label and categorize incoming emails
  1. AI Chat Agent — A conversational assistant that uses the user's emails as its knowledge base
  1. (Bonus) Newsletter Deduplication — Deduplicate news items across multiple newsletter sources

---
**▸ Technical Stack**
  You are required to use the following:

---

## Feature Specifications
**▸ 1. Gmail Integration**
  - Implement OAuth 2.0 authentication using the Gmail API (not IMAP/SMTP)
  - Sync the user's inbox — messages, threads, labels, and metadata
  - Handle pagination for large inboxes gracefully (the solution must not break or degrade with thousands of emails)
  - Implement proper API rate limiting and quota management — handle 429 responses, implement exponential backoff, and ensure the application does not exceed Gmail API quotas
  - Store synced email data in Supabase with a well-designed schema
  - Support incremental sync (only fetch new/changed emails after initial sync)
**▸ 2. Email Summarization**
  - Generate a concise summary for each individual email
  - Generate a thread-level summary that understands the full conversation arc
  - Summaries must be context-aware — a reply in a thread should be understood in the context of the whole thread, not in isolation
**▸ 3. Compose & Reply**
  Compose New Email
  - User provides a short natural-language prompt (e.g., "Write a follow-up to the product team about the Q3 launch delay")
  - AI drafts a complete, professional email
  - User can review, edit, and send — or discard
  Reply to an Existing Email
  - User selects an email or thread and requests a reply with a short prompt
  - AI generates the reply with full thread context — it must understand what has been said before and draft an appropriate response
  - Reply must preserve thread headers (In-Reply-To, References) so it appears correctly in Gmail as part of the same thread
**▸ 4. Thread Awareness**
  - The system must understand and represent email threads, not just individual messages
  - All features (summarization, reply drafting, agent queries) must operate on threads as a first-class concept
  - When a user references a thread in conversation, the AI must reason over the entire thread history
**▸ 5. Email Categorization & Labeling**
  Automatically classify emails into categories. At minimum, support:
  - Newsletters — Subscription-based content and digests
  - Job / Recruitment — Applications, offers, rejections, interview requests
  - Finance — Invoices, receipts, bank alerts, payments
  - Notifications — System alerts, OTPs, platform updates
  - Personal — Direct human-to-human communication
  - Work / Professional — Project discussions, team communication
  Categories must be stored in Supabase and surfaced in the UI. The candidate may extend or refine this taxonomy — justify any decisions made.
**▸ 6. AI Chat Agent**
  The chat agent is the centerpiece of this platform. It must behave as a knowledgeable assistant that has read all of the user's emails.
  Core Requirements:
  - The agent must use the user's emails as its exclusive knowledge base for email-related queries
  - The agent must maintain source clarity — when answering a question, it must know and be able to state which email, thread, or sender the information came from
  - The agent must handle cross-email reasoning — if multiple emails discuss the same topic (e.g., a vendor, a project, a technology), the agent must synthesize across all of them and present a coherent, unified answer
  - The agent must maintain conversational context — follow-up questions should be understood in the context of the ongoing conversation
  Example Interactions the Agent Must Handle:
  - "Summarize all emails from Acme Corp this month"
  - "Which companies rejected my job application? List them all."
  - "What has been discussed about the data migration project? Pull from all related threads."
  - "Give me an overview of what I know about Kubernetes from my emails." — If multiple emails from different senders discuss Kubernetes, the agent synthesizes them into one coherent explanation, clearly attributing each piece of information to its source
  - "List all important tech news from the past 4 days" — The agent identifies newsletter emails, extracts news items, and presents a clean, organized list — removing duplicates where the same story appears across multiple sources
  Important: The agent must not hallucinate. If information is not present in the email knowledge base, it must say so clearly.
**▸ 7. (Bonus) Newsletter Deduplication**
  When the user requests a news digest or asks for recent updates from newsletters:
  - Identify that multiple newsletter sources may carry the same story
  - Deduplicate news items using semantic similarity (not just exact title matching)
  - Present a clean, unified list — each unique story appearing only once, with attribution to the original source(s)

---

## Deliverables
**▸ GitHub Repository**
  **▸ Your repository must include:**
    - Complete source code, organized and readable
    - A README.md with:
      [MISSING 38221e63-6a2b-8031-bd80-f7edb10800b4]
      [MISSING 38221e63-6a2b-80f2-935a-cc6458acea9f]
      [MISSING 38221e63-6a2b-80a1-b66b-f5c257ecc53e]
    - .env.example file
  **▸ Architecture & Design Document Architecture.md**
    Submit a single Markdown document (included in your repository) covering the following sections:
    1. System Architecture
A diagram or detailed description of how all components interact — frontend, backend, Supabase, Gmail API, AI models, and any queues or background workers.
    2. Database Schema
Full schema design for Supabase — all tables, columns, relationships, and indexes. Explain your data modeling decisions. If you use pgvector, explain what is being embedded and why.
    3. AI Design
    - How do you implement email summarization? What is your chunking / context strategy for long threads?
    - How does the chat agent retrieve relevant emails? (Describe your RAG pipeline — embedding, indexing, retrieval, reranking if applicable)
    - How does the agent maintain source clarity across multiple emails?
    - Why did you choose your specific NVIDIA NIM model? What is its role in the system?
    - How do you prevent the agent from hallucinating or mixing up unrelated email content?
    4. Gmail API Strategy
    - How do you handle initial sync vs. incremental sync?
    - How do you manage pagination for large inboxes?
    - How do you implement rate limiting and quota handling?
    5. Tool & Technology Decisions
A short justification for frontend framework, backend framework, job queue (if any), vector DB approach, etc.
    6. Trade-offs & Limitations
What did you deliberately not build or simplify? What would you do differently with more time?

---
**▸ Evaluation Criteria**
  Your submission will be reviewed across the following dimensions:

---
**▸ Guidelines & Constraints**
  - Do not expose API keys, OAuth credentials, or secrets in your repository
  - All AI-generated content within the app must be clearly attributed to its source email(s)
  - The application must be functional — a partial but working submission is valued over an over-engineered one that does not run
  - You may use open-source libraries freely — cite any significant ones in your document
  - You may use AI coding tools — but you must be able to explain every part of your submission

---

## Submission Instructions
1. Push your code to a GitHub repository (public)
1. Deploy the application and link it to the github repo.
1. Include your Architecture & Design Document as a Markdown file in the repository root
1. Ensure your README.md is complete and setup instructions are accurate.
1. Fill this form ‣ on or before June 19th, 10:00 pm, 2026

---
**▸ Final Note**
  This assignment is intentionally difficult.
  The company is not expecting a perfect solution, but function solution with your approch and understanding
  They want to see:
  - How you think
  - How you design systems
  - How you handle real-world problems
  - How clean and understandable your code is
  Focus on doing the core features well, instead of adding many features badly.