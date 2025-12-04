// Vercel Serverless Function: /api/chat
// This endpoint receives a JSON body { message: string }
// It uses Coze API (v3) to get a response from the configured bot.
// Environment variables required (set in Vercel project settings):
//   COZE_API_TOKEN - Personal Access Token for Coze
//   COZE_BOT_ID    - Bot ID to interact with

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'Missing "message" in request body' });
  }

  const apiToken = process.env.COZE_API_TOKEN;
  const botId = process.env.COZE_BOT_ID;
  if (!apiToken || !botId) {
    return res.status(500).json({ error: 'Coze API token or Bot ID not configured in environment variables.' });
  }

  try {
    // 1️⃣ Create a chat session
    const createResp = await fetch('https://api.coze.com/v3/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        bot_id: botId,
        user_id: `vercel_${Date.now()}`,
        stream: false,
        auto_save_history: true,
        additional_messages: [
          {
            role: 'user',
            content: message,
            content_type: 'text',
          },
        ],
      }),
    });

    const createData = await createResp.json();
    if (createData.code !== 0) {
      return res.status(500).json({ error: createData.msg || 'Failed to start Coze chat' });
    }

    const chatId = createData.data.id;
    const conversationId = createData.data.conversation_id;

    // 2️⃣ Poll for completion (max 30 attempts, 1s interval)
    let status = createData.data.status;
    let attempts = 0;
    while (status === 'in_progress' && attempts < 30) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollResp = await fetch(
        `https://api.coze.com/v3/chat/retrieve?chat_id=${chatId}&conversation_id=${conversationId}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
        }
      );
      const pollData = await pollResp.json();
      if (pollData.code !== 0) {
        return res.status(500).json({ error: pollData.msg || 'Error while polling Coze chat' });
      }
      status = pollData.data.status;
      attempts++;
    }

    if (status !== 'completed') {
      return res.status(500).json({ error: `Chat did not complete (status: ${status})` });
    }

    // 3️⃣ Retrieve messages to get the assistant's answer
    const msgResp = await fetch(
      `https://api.coze.com/v3/chat/message/list?chat_id=${chatId}&conversation_id=${conversationId}`,
      {
        headers: { Authorization: `Bearer ${apiToken}` },
      }
    );
    const msgData = await msgResp.json();
    if (msgData.code !== 0) {
      return res.status(500).json({ error: msgData.msg || 'Failed to fetch chat messages' });
    }

    const botMessages = msgData.data.filter(
      (m) => m.role === 'assistant' && m.type === 'answer'
    );
    const reply = botMessages.length > 0 ? botMessages[botMessages.length - 1].content : '';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Coze chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
