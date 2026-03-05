from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openai
import os
import joblib
import pandas as pd
import json
from dotenv import load_dotenv # <-- NEW IMPORT

# Load the secrets from the .env file
load_dotenv() 

app = FastAPI(title="VitalsFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Set up AI Client
# Grab the key securely from the environment
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

client = openai.OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=GROQ_API_KEY
)
# 3. Load the trained XGBoost model
try:
    triage_model = joblib.load("xgboost_real_triage.joblib")
except FileNotFoundError:
    triage_model = None

# 4. Define Data Models
class PatientVitals(BaseModel):
    SBP: float
    DBP: float
    HR: float
    RR: float
    BT: float
    Saturation: float

class CustomItem(BaseModel):
    name: str
    item_type: str  # 'test' or 'medication'

# 5. The Smart Triage Endpoint (Hybrid AI + Clinical Guardrails)
@app.post("/api/triage")
def evaluate_triage(vitals: PatientVitals):
    if not triage_model:
        return {"status": "error", "message": "Triage model is not loaded."}
    
    # --- CLINICAL GUARDRAIL (Safety Net) ---
    is_perfectly_normal = (
        (90 <= vitals.SBP <= 120) and
        (60 <= vitals.DBP <= 80) and
        (60 <= vitals.HR <= 100) and
        (12 <= vitals.RR <= 20) and
        (36.0 <= vitals.BT <= 37.5) and
        (vitals.Saturation >= 95)
    )
    
    if is_perfectly_normal:
        prediction = 5  # Level 5: Non-Urgent
    else:
        input_data = pd.DataFrame([vitals.model_dump()])
        prediction = int(triage_model.predict(input_data)[0]) + 1
    
    risk_mapping = {
        1: {"status": "Critical / Resuscitation", "action": "Immediate Intervention", "color": "red"},
        2: {"status": "Emergent", "action": "Physician evaluation within 15 min", "color": "orange"},
        3: {"status": "Urgent", "action": "Physician evaluation within 30 min", "color": "yellow"},
        4: {"status": "Less Urgent", "action": "Physician evaluation within 60 min", "color": "green"},
        5: {"status": "Non-Urgent", "action": "Standard Waiting Room", "color": "blue"}
    }
    
    result = risk_mapping.get(prediction, {"status": "Unknown", "action": "Review Manually", "color": "grey"})
    return {"vitals_received": vitals.model_dump(), "triage_alert": result}
    
# 6. The Whisper AI Scribe & Llama 3 Co-Pilot Endpoint
@app.post("/api/scribe")
async def process_audio(file: UploadFile = File(...)):
    print("\n--- NEW SCRIBE REQUEST INITIATED ---")
    try:
        print("Step 1: Saving audio file...")
        temp_file_path = f"temp_{file.filename}"
        with open(temp_file_path, "wb") as buffer:
            buffer.write(await file.read())

        print("Step 2: Sending to Groq Whisper for Translation...")
        with open(temp_file_path, "rb") as audio_file:
            transcript_response = client.audio.translations.create(
                model="whisper-large-v3",
                file=audio_file,
                response_format="text"
            )
        
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
            
        transcript_text = transcript_response
        print(f"-> Translation Success! Text: {transcript_text[:50]}...")

        print("Step 3: Sending to Groq Llama 3 for Clinical Analysis...")
        prompt = f"""
        You are an expert AI clinical assistant. Analyze this patient-doctor conversation transcript.
        CRITICAL INSTRUCTION: The patient may speak in English, Kannada, or "Kanglish" (Kannada words spelled with English letters, e.g., "tale novtaide" which means "headache"). 
        First, translate any Kannada/Kanglish into English. Then, generate a structured JSON object exactly in this format:
        {{
            "soap_notes": "A professional 2-3 sentence summary of the visit in English.",
            "suggested_tests": [{{"name": "Blood Test", "cost_estimate": "₹500"}}],
            "suggested_medicines": [
                {{
                    "name": "Paracetamol 500mg", 
                    "cost_estimate": "₹5",
                    "morning": true,
                    "afternoon": false,
                    "night": true,
                    "food": "After Food",
                    "duration": "5 days"
                }}
            ]
        }}
        IMPORTANT: cost_estimate for medicines MUST be the price PER SINGLE TABLET.
        Only return the raw JSON, no markdown, no other text.
        
        Transcript: {transcript_text}
        """

        llm_response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"}
        )

        print("Step 4: Parsing AI JSON Response...")
        clinical_data = json.loads(llm_response.choices[0].message.content)
        
        print("-> Pipeline Complete! Sending to Frontend.")
        return {
            "status": "success", 
            "transcript": transcript_text,
            "clinical_data": clinical_data
        }

    except Exception as e:
        print(f"\n!!! ERROR OCCURRED !!!\n{str(e)}")
        return {"status": "error", "message": str(e)}

# 7. Real-Time Price Predictor Endpoint
@app.post("/api/estimate")
def estimate_price(item: CustomItem):
    if not client:
        return {"status": "error", "cost": "₹TBD"}
        
    try:
        print(f"Estimating cost for: {item.name}")
        prompt = f"""
        Estimate the average cost in INR (₹) PER SINGLE TABLET or PER TEST for this medical {item.item_type}: '{item.name}'.
        Reply ONLY with a valid JSON object in this exact format: {{"cost": "₹XXX"}}
        Do not add any explanations or markdown.
        """
        
        llm_response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        
        data = json.loads(llm_response.choices[0].message.content)
        cost = data.get("cost", "₹TBD")
        
        if item.item_type == "medication":
            return {
                "status": "success", 
                "cost": cost,
                "morning": False, "afternoon": False, "night": False,
                "food": "After Food", "duration": ""
            }
        else:
            return {"status": "success", "cost": cost}
        
    except Exception as e:
        print(f"Price Predictor Error: {e}")
        return {"status": "error", "cost": "₹TBD"}