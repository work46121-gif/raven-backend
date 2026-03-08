# 🪶 RAVEN SMS Backend
**Request Automatically Via Every Network**

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Fill in your Twilio credentials
```

### 3. Set up Supabase database
- Go to your Supabase project
- Open SQL Editor
- Paste and run the contents of schema.sql

### 4. Run locally
```bash
npm start
```

### 5. Deploy to Railway
- Push this folder to GitHub
- Connect Railway to your repo
- Add environment variables in Railway dashboard
- Copy your Railway URL
- Set it as your Twilio webhook:
  Twilio Console → Phone Numbers → Your Number → Messaging → Webhook URL
  Set to: https://your-app.railway.app/sms

## SMS Commands

| Command | Example | Description |
|---------|---------|-------------|
| SPLIT | `SPLIT $120 Dinner @Jake @Mia` | Create a new bill |
| PAID | `PAID B7K2` | Mark yourself as paid |
| PAID [name] | `PAID B7K2 Jake` | Mark someone paid by name |
| REMIND | `REMIND B7K2` | Ping everyone who still owes |
| STATUS | `STATUS B7K2` | See bill status |
| BILLS | `BILLS` | See all your active bills |
| HELP | `HELP` | Show all commands |

## Environment Variables

```
TWILIO_ACCOUNT_SID=      # From twilio.com/console
TWILIO_AUTH_TOKEN=       # From twilio.com/console  
TWILIO_PHONE_NUMBER=     # Your Twilio number e.g. +15162347187
SUPABASE_URL=            # Your Supabase project URL
SUPABASE_SERVICE_KEY=    # Your Supabase service role key
PORT=3000
```
