// Telegram types (minimal subset we use)
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

export interface TelegramChat {
  id: number;
}

// App types
export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_TELEGRAM_ID: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
  GITHUB_PAT: string;
  GITHUB_REPO: string;
  INVITE_CODE_SECRET: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  WEB_ORIGIN: string;       // CORS origin, e.g. https://owner.github.io
  WEB_REDIRECT_URL: string; // Magic link redirect, e.g. https://owner.github.io/oraculobot/jugar.html
}

export interface DbUser {
  id: string;
  telegram_id: number | null;
  username: string | null;
  is_admin: boolean;
  invite_code: string | null;
  auth_user_id?: string | null;
  questions_today: number;
  questions_reset_at?: string | null;
  created_at: string;
}

// Web API request types
export interface WebRegisterRequest {
  email: string;
  invite_code: string;
}

export interface WebPredictRequest {
  match_id: string;
  home_score: number;
  away_score: number;
}

export interface WebQuestionRequest {
  question: string;
}

export interface DbMatch {
  id: string;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  phase: string;
  group_name: string | null;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'finished';
}

export interface DbPrediction {
  id: string;
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbInviteCode {
  code: string;
  created_by: string;
  max_uses: number;
  use_count: number;
  created_at: string;
}

export interface ConversationState {
  telegram_id: number;
  step: string;
  context: Record<string, unknown>;
  updated_at: string;
}
