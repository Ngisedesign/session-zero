import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const GM_SYSTEM_PROMPT = `You are an experienced Dungeon Master running a "Session Zero" character development experience. Your goal is to help a player flesh out their D&D character through an immersive ~15 minute conversational roleplay session.

IMPORTANT GUIDELINES:

1. SESSION STRUCTURE:
- Start by asking the player to briefly describe their character concept (class, race, basic background)
- Then immerse them in a short narrative scenario from their character's past
- The session should feel like playing through a formative moment in their character's history

2. SCENARIO DESIGN:
- Create vivid, sensory-rich scenes with interesting NPCs
- Include a mix of: exploration, investigation, social encounters
- Present at least one moral dilemma with no clear "right" answer
- Offer opportunities for creative problem-solving (not combat-focused)
- Build toward a character-defining moment that reveals who they truly are

3. PACING:
- Keep your responses concise but evocative (2-4 paragraphs typically)
- Ask what the player does/says, then react to their choices
- After about 12-15 exchanges, begin naturally concluding the scene
- End with a reflective moment that ties back to who this character has become

4. TONE:
- Be descriptive but not overwrought
- Make NPCs feel real with distinct voices
- Respond meaningfully to player choices - their decisions matter
- Create emotional stakes without being melodramatic

5. NO DICE:
- This is pure narrative roleplay - no dice rolls, no mechanics
- Focus entirely on story, character, and choices
- If the player tries to do something, describe what happens narratively

Remember: This is about discovering who this character is through their choices in a meaningful scenario. Help the player understand their character's values, fears, bonds, and what drives them.

Begin by warmly welcoming the player and asking them to tell you about the character they're creating.`;

const QUICK_START_SYSTEM_PROMPT = `You are an experienced Dungeon Master running a "Session Zero" character development experience. Your goal is to help a player discover their D&D character through an immersive ~15 minute conversational roleplay session.

QUICK START MODE - NO PREAMBLE:
- Do NOT ask the player about their character beforehand
- Immediately drop them into an evocative scenario
- Let who they are emerge naturally through their choices and actions
- Discover their class, race, and background through how they respond

SCENARIO DESIGN:
- Start in media res - an interesting moment already happening
- Create vivid, sensory-rich scenes with interesting NPCs
- Include a mix of: exploration, investigation, social encounters
- Present at least one moral dilemma with no clear "right" answer
- Offer opportunities for creative problem-solving (not combat-focused)
- Build toward a character-defining moment that reveals who they truly are

PACING:
- Keep your responses concise but evocative (2-4 paragraphs typically)
- Ask what the player does/says, then react to their choices
- Naturally weave in questions about their character through the narrative ("You reach for your weapon - what do you carry?" or "The guard asks your name...")
- After about 12-15 exchanges, begin naturally concluding the scene
- End with a reflective moment summarizing who this character has revealed themselves to be

TONE:
- Be descriptive but not overwrought
- Make NPCs feel real with distinct voices
- Respond meaningfully to player choices - their decisions matter
- Create emotional stakes without being melodramatic

NO DICE:
- This is pure narrative roleplay - no dice rolls, no mechanics
- Focus entirely on story, character, and choices
- If the player tries to do something, describe what happens narratively

Begin IMMEDIATELY with a compelling scene - no introductions, no asking about their character. Just drop them right in.`;

// Endpoint to get Deepgram API key for client-side use
app.get('/api/deepgram-key', (req, res) => {
  if (!process.env.DEEPGRAM_API_KEY) {
    return res.status(500).json({ error: 'Deepgram API key not configured' });
  }
  res.json({ apiKey: process.env.DEEPGRAM_API_KEY });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, mode } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const systemPrompt = mode === 'quick' ? QUICK_START_SYSTEM_PROMPT : GM_SYSTEM_PROMPT;

    // Build messages array from history
    const messages = [];

    if (history && Array.isArray(history)) {
      for (const msg of history) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add the new user message
    messages.push({
      role: 'user',
      content: message,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    const assistantMessage = response.content[0].text;

    res.json({
      message: assistantMessage,
      role: 'assistant',
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Failed to get response from GM',
      details: error.message
    });
  }
});

// Start session - gets initial GM greeting
app.post('/api/start-session', async (req, res) => {
  try {
    const { mode } = req.body || {};
    const isQuickStart = mode === 'quick';
    const systemPrompt = isQuickStart ? QUICK_START_SYSTEM_PROMPT : GM_SYSTEM_PROMPT;
    const userMessage = isQuickStart
      ? 'Begin the scene.'
      : 'I\'m ready to begin my Session Zero.';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const assistantMessage = response.content[0].text;

    res.json({
      message: assistantMessage,
      role: 'assistant',
      mode: isQuickStart ? 'quick' : 'normal',
    });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({
      error: 'Failed to start session',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Session Zero server running at http://localhost:${PORT}`);
});
