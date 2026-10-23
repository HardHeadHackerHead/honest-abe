/** FAQ entries shared by the home page and the docs FAQ. Answers are plain HTML. */
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: 'Is Abe really free?',
    a: 'Yes. Abe is free and open source under the AGPL-3.0-or-later license. There is no paid tier, no trial and no account. If you use a cloud provider, you pay that provider directly for what you use; in local mode it costs nothing at all.',
  },
  {
    q: 'Do I need an API key?',
    a: 'No. Pick <strong>Local</strong> and Abe downloads a Whisper model once, then transcribes entirely on your computer, offline. If you want faster or more accurate results on modest hardware, paste an API key instead. We recommend <a href="/docs/api-keys/groq">Groq</a>, which is free to start; OpenAI and any OpenAI-compatible endpoint work too. See <a href="/docs/api-keys">Getting an API key</a>.',
  },
  {
    q: 'Can you hear or store my audio?',
    a: 'No. There is no Abe server. In local mode audio never leaves your machine. In cloud mode it goes from your computer directly to the provider you chose, using your key, under that provider\'s data policy. The app has no telemetry.',
  },
  {
    q: 'How much does cloud transcription cost?',
    a: 'A few cents per hour of talking: roughly $0.04 an hour with Groq and $0.27 an hour with OpenAI at current list prices. See <a href="/docs/costs">Costs</a> for the table and a calculator.',
  },
  {
    q: 'Which apps does it work in?',
    a: 'Any app where you can type: email, chat, documents, browsers, code editors, terminals. Abe inserts text at your cursor by pasting it, or by typing it out key by key in typewriter mode for apps that block pasting.',
  },
  {
    q: 'Which platforms are supported?',
    a: 'Windows 10 and 11 (x64), and macOS 10.15 or later (Apple Silicon and Intel). Linux is coming soon.',
  },
  {
    q: 'Where is my API key stored?',
    a: 'In your operating system\'s secure credential store: Windows Credential Manager or the macOS Keychain. It is never written to a plain settings file and is never sent anywhere except to the provider it belongs to.',
  },
  {
    q: 'How is Abe funded?',
    a: 'By donations. They pay for code-signing certificates, the Apple Developer fee, the domain and development time. <a href="/donate">Support the project</a> if Abe saves you time.',
  },
];
