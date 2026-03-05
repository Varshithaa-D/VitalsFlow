import pandas as pd
import xgboost as xgb
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

# 1. Load the REAL Kaggle Dataset
df = pd.read_csv("data.csv", sep=';', encoding='latin1')
# 2. Select the Vitals (Features) and the Triage Level (Target)
features = ['SBP', 'DBP', 'HR', 'RR', 'BT', 'Saturation']
target = 'KTAS_expert'

# Filter the dataframe to just what we need
data = df[features + [target]].copy()

# 3. Data Cleaning
# Real clinical data is messy. Let's drop rows with missing (NaN) vitals.
data = data.dropna()

# Convert feature columns to numeric (in case they were loaded as strings)
for feature in features:
    data[feature] = pd.to_numeric(data[feature], errors='coerce')

# Drop any rows that couldn't be converted to numeric
data = data.dropna()

X = data[features]
# XGBoost expects classes to start at 0. KTAS is 1-5, so we subtract 1.
y = data[target] - 1 

# 4. Train/Test Split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# 5. Train the XGBoost Model
print("Training on real ER data...")
model = xgb.XGBClassifier(objective="multi:softmax", num_class=5, eval_metric="mlogloss")
model.fit(X_train, y_train)

# 6. Quick Accuracy Check
predictions = model.predict(X_test)
acc = accuracy_score(y_test, predictions)
print(f"Model Accuracy on real test data: {acc * 100:.2f}%")

# 7. Save the Model
joblib.dump(model, "xgboost_real_triage.joblib")
print("Real model saved as 'xgboost_real_triage.joblib'")