import { useState } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('scribe');

  // --- TRIAGE STATE ---
  const [vitals, setVitals] = useState({ SBP: '', DBP: '', HR: '', RR: '', BT: '', Saturation: '' });
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- SCRIBE & CO-PILOT STATE ---
  const [transcription, setTranscription] = useState("");
  const [clinicalData, setClinicalData] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  
  const [selectedTests, setSelectedTests] = useState([]);
  const [selectedMeds, setSelectedMeds] = useState([]);
  
  const [customTest, setCustomTest] = useState("");
  const [customMed, setCustomMed] = useState("");
  const [isPredictingCost, setIsPredictingCost] = useState(false);

  // --- RECEIPT STATE ---
  const [showReceipt, setShowReceipt] = useState(false);
  const [totalCost, setTotalCost] = useState(0);

  const handleInputChange = (e) => setVitals({ ...vitals, [e.target.name]: e.target.value });

  const handleTriageSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setAlert(null);
    try {
      const response = await fetch("http://localhost:8000/api/triage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SBP: parseFloat(vitals.SBP), DBP: parseFloat(vitals.DBP), HR: parseFloat(vitals.HR),
          RR: parseFloat(vitals.RR), BT: parseFloat(vitals.BT), Saturation: parseFloat(vitals.Saturation)
        }),
      });
      const data = await response.json();
      setAlert(data.triage_alert);
    } catch (error) { setAlert({ status: "Error", action: "Check server", color: "gray" }); }
    setLoading(false);
  };

  const startRecording = async () => {
    try {
      setClinicalData(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        setIsTranscribing(true);
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        try {
          const response = await fetch("http://localhost:8000/api/scribe", { method: "POST", body: formData });
          const data = await response.json();
          if (data.status === "success") {
            setTranscription(data.transcript);
            setClinicalData(data.clinical_data);
            setSelectedTests(data.clinical_data.suggested_tests.map(t => t.name));
            setSelectedMeds(data.clinical_data.suggested_medicines.map(m => m.name));
          } else { setTranscription("Error: " + data.message); }
        } catch (error) { setTranscription("Failed to connect to backend server."); }
        setIsTranscribing(false);
      };

      recorder.start(); setMediaRecorder(recorder); setIsRecording(true);
    } catch (error) { alert("Microphone access denied."); }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop(); setIsRecording(false);
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  };

  const toggleTest = (testName) => setSelectedTests(prev => prev.includes(testName) ? prev.filter(t => t !== testName) : [...prev, testName]);
  const toggleMed = (medName) => setSelectedMeds(prev => prev.includes(medName) ? prev.filter(m => m !== medName) : [...prev, medName]);

  // --- NEW: REMOVE ITEMS COMPLETELY ---
  const removeTest = (testName) => {
    setClinicalData(prev => ({ ...prev, suggested_tests: prev.suggested_tests.filter(t => t.name !== testName) }));
    setSelectedTests(prev => prev.filter(t => t !== testName));
  };

  const removeMed = (medName) => {
    setClinicalData(prev => ({ ...prev, suggested_medicines: prev.suggested_medicines.filter(m => m.name !== medName) }));
    setSelectedMeds(prev => prev.filter(m => m !== medName));
  };

  const updateMedDetails = (index, field, value) => {
    setClinicalData(prev => {
      const newMeds = [...prev.suggested_medicines];
      newMeds[index] = { ...newMeds[index], [field]: value };
      return { ...prev, suggested_medicines: newMeds };
    });
  };

  const handleAddCustomTest = async (e) => {
    if (e.key === 'Enter' && customTest.trim() !== '') {
      e.preventDefault();
      const testName = customTest.trim();
      setCustomTest(""); setIsPredictingCost(true);
      try {
        const res = await fetch("http://localhost:8000/api/estimate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: testName, item_type: "test" })
        });
        const data = await res.json();
        const newTest = { name: testName, cost_estimate: data.cost || "₹TBD" };
        setClinicalData(prev => ({ ...prev, suggested_tests: [...prev.suggested_tests, newTest] }));
        setSelectedTests(prev => [...prev, newTest.name]);
      } catch (error) { console.error(error); }
      setIsPredictingCost(false);
    }
  };

  const handleAddCustomMed = async (e) => {
    if (e.key === 'Enter' && customMed.trim() !== '') {
      e.preventDefault();
      const medName = customMed.trim();
      setCustomMed(""); setIsPredictingCost(true);
      try {
        const res = await fetch("http://localhost:8000/api/estimate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: medName, item_type: "medication" })
        });
        const data = await res.json();
        const newMed = { 
          name: medName, cost_estimate: data.cost || "₹TBD",
          morning: data.morning || false, afternoon: data.afternoon || false, night: data.night || false,
          food: data.food || "After Food", duration: data.duration || ""
        };
        setClinicalData(prev => ({ ...prev, suggested_medicines: [...prev.suggested_medicines, newMed] }));
        setSelectedMeds(prev => [...prev, newMed.name]);
      } catch (error) { console.error(error); }
      setIsPredictingCost(false);
    }
  };

  const handleFinalize = () => {
    let total = 0;

    const getNumber = (str) => {
      if (!str) return 0;
      const num = parseInt(str.replace(/\D/g, ''));
      return isNaN(num) ? 0 : num;
    };

    clinicalData.suggested_tests.forEach(test => {
      if (selectedTests.includes(test.name)) {
        total += getNumber(test.cost_estimate);
      }
    });

    clinicalData.suggested_medicines.forEach(med => {
      if (selectedMeds.includes(med.name)) {
        const unitPrice = getNumber(med.cost_estimate);
        const dosesPerDay = (med.morning ? 1 : 0) + (med.afternoon ? 1 : 0) + (med.night ? 1 : 0);
        const durationMatch = med.duration ? med.duration.match(/\d+/) : null;
        const durationValue = durationMatch ? parseInt(durationMatch[0]) : 1;
        
        let totalQty = 1;
        if (med.duration && med.duration.toLowerCase().includes('day')) {
          totalQty = durationValue * (dosesPerDay || 1); 
        } else {
          totalQty = durationValue; 
        }

        total += (unitPrice * totalQty);
      }
    });

    setTotalCost(total);
    setShowReceipt(true);
  };

  const styles = {
    page: { height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f5f9', padding: '1rem', boxSizing: 'border-box', fontFamily: '"Inter", system-ui, sans-serif', color: '#0f172a' },
    nav: { display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' },
    navButton: (isActive) => ({ padding: '0.6rem 1.5rem', borderRadius: '8px', border: 'none', fontSize: '1rem', fontWeight: '600', cursor: 'pointer', backgroundColor: isActive ? '#0284c7' : '#e2e8f0', color: isActive ? 'white' : '#475569' }),
    header: { textAlign: 'center', marginBottom: '1rem' },
    title: { fontSize: '1.8rem', fontWeight: '800', margin: '0 0 0.25rem 0' },
    grid: { display: 'flex', gap: '1.5rem', maxWidth: '1200px', width: '100%', margin: '0 auto', flex: 1, minHeight: 0 },
    card: { flex: '1', backgroundColor: '#ffffff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', minHeight: 0 },
    scrollArea: { flex: 1, overflowY: 'auto', paddingRight: '0.5rem', marginTop: '1rem' },
    cardTitle: { fontSize: '1.1rem', fontWeight: '700', margin: '0 0 0.5rem 0', color: '#334155', textTransform: 'uppercase' },
    button: { width: '100%', padding: '0.75rem', backgroundColor: '#0284c7', color: 'white', border: 'none', borderRadius: '6px', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' },
    checkItem: { display: 'flex', flexDirection: 'column', padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', marginBottom: '0.5rem' },
    costBadge: { backgroundColor: '#dcfce7', color: '#166534', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' },
    deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0 0 0 0.5rem', opacity: 0.6, transition: 'opacity 0.2s' },
    modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
    modalCard: { backgroundColor: 'white', padding: '2.5rem', borderRadius: '16px', width: '500px', maxWidth: '90%', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' },
    receiptRow: { padding: '0.75rem 0', borderBottom: '1px solid #e2e8f0' }
  };

  return (
    <div style={styles.page}>
      
      {/* --- DISCHARGE RECEIPT MODAL --- */}
      {showReceipt && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, color: '#0284c7', fontSize: '1.8rem' }}>Patient Discharged</h2>
              <p style={{ color: '#64748b', margin: '0.5rem 0 0 0' }}>Prescription & Billing Summary</p>
            </div>
            
            <div style={{ marginBottom: '1.5rem', maxHeight: '300px', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#334155' }}>Approved Lab Tests:</h4>
              {clinicalData.suggested_tests.filter(t => selectedTests.includes(t.name)).map((test, idx) => (
                <div key={`test-${idx}`} style={{...styles.receiptRow, display: 'flex', justifyContent: 'space-between'}}>
                  <span style={{ color: '#475569', fontWeight: 'bold' }}>{test.name}</span>
                  <span style={{ color: '#166534', fontWeight: '500' }}>{test.cost_estimate}</span>
                </div>
              ))}

              <h4 style={{ margin: '1.5rem 0 0.5rem 0', color: '#334155' }}>Prescribed Medications:</h4>
              {clinicalData.suggested_medicines.filter(m => selectedMeds.includes(m.name)).map((med, idx) => {
                const unitPrice = parseInt(med.cost_estimate.replace(/\D/g, '')) || 0;
                const dosesPerDay = (med.morning ? 1 : 0) + (med.afternoon ? 1 : 0) + (med.night ? 1 : 0);
                const durationMatch = med.duration ? med.duration.match(/\d+/) : null;
                const durationValue = durationMatch ? parseInt(durationMatch[0]) : 1;
                const totalQty = med.duration && med.duration.toLowerCase().includes('day') ? (durationValue * (dosesPerDay || 1)) : durationValue;
                const lineTotal = unitPrice * totalQty;

                return (
                  <div key={`med-${idx}`} style={styles.receiptRow}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ color: '#475569', fontWeight: 'bold' }}>{med.name} (x{totalQty})</span>
                      <span style={{ color: '#166534', fontWeight: '500' }}>₹{lineTotal}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                      <strong>Sig:</strong> {med.morning ? '1' : '0'}-{med.afternoon ? '1' : '0'}-{med.night ? '1' : '0'} | {med.food} | {med.duration}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0f172a' }}>Estimated Total:</span>
              <span style={{ fontSize: '1.5rem', fontWeight: '900', color: '#dc2626' }}>₹{totalCost}</span>
            </div>

            <button onClick={() => setShowReceipt(false)} style={{...styles.button, backgroundColor: '#0f172a'}}>Close & Return</button>
          </div>
        </div>
      )}

      <nav style={styles.nav}>
        <button style={styles.navButton(activeTab === 'triage')} onClick={() => setActiveTab('triage')}>1. Smart Triage</button>
        <button style={styles.navButton(activeTab === 'scribe')} onClick={() => setActiveTab('scribe')}>2. AI Co-Pilot & Scribe</button>
      </nav>

      <header style={styles.header}>
        <h1 style={styles.title}>VitalsFlow Engine</h1>
      </header>

      {/* VIEW 1: SMART TRIAGE */}
      {activeTab === 'triage' && (
        <div style={styles.grid}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Patient Intake Vitals</h2>
            <form onSubmit={handleTriageSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
              <input style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} type="number" name="SBP" value={vitals.SBP} onChange={handleInputChange} placeholder="Systolic BP" required />
              <input style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} type="number" name="DBP" value={vitals.DBP} onChange={handleInputChange} placeholder="Diastolic BP" required />
              <input style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} type="number" name="HR" value={vitals.HR} onChange={handleInputChange} placeholder="Heart Rate" required />
              <input style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} type="number" name="RR" value={vitals.RR} onChange={handleInputChange} placeholder="Resp Rate" required />
              <input style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} type="number" name="BT" value={vitals.BT} onChange={handleInputChange} placeholder="Temp (°C)" required />
              <input style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }} type="number" name="Saturation" value={vitals.Saturation} onChange={handleInputChange} placeholder="SpO2 %" required />
              <button type="submit" disabled={loading} style={{...styles.button, gridColumn: '1 / -1', marginTop: '1rem'}}>{loading ? 'Processing...' : 'Assess Patient Acuity'}</button>
            </form>
          </div>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Acuity Level</h2>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {alert ? (
                <div style={{ backgroundColor: alert.color === 'red' ? '#fef2f2' : alert.color === 'yellow' ? '#fefce8' : '#f0fdf4', border: `2px solid ${alert.color}`, padding: '2rem', borderRadius: '10px', width: '100%', textAlign: 'center' }}>
                  <h1 style={{ color: alert.color === 'red' ? '#991b1b' : '#166534', margin: '0 0 0.5rem 0' }}>{alert.status}</h1>
                  <p><strong>Protocol:</strong> {alert.action}</p>
                </div>
              ) : <p style={{ color: '#94a3b8' }}>Awaiting patient vitals.</p>}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: AI CO-PILOT */}
      {activeTab === 'scribe' && (
        <div style={styles.grid}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Consultation Scribe</h2>
            <div style={{ marginBottom: '1rem' }}>
              {!isRecording ? (
                <button onClick={startRecording} style={{...styles.button, backgroundColor: '#dc2626'}}>🎤 Start Recording</button>
              ) : (
                <button onClick={stopRecording} style={{...styles.button, backgroundColor: '#0f172a'}}>⏹ Stop & Analyze</button>
              )}
              {isTranscribing && <p style={{ color: '#0284c7', fontSize: '0.9rem', marginTop: '0.5rem', textAlign: 'center' }}>Generating Clinical Plan...</p>}
            </div>
            <div style={styles.scrollArea}>
              {clinicalData ? (
                <>
                  <h3 style={{ fontSize: '1rem', color: '#0284c7', marginTop: 0 }}>Generated SOAP Notes</h3>
                  <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px', fontSize: '0.95rem', lineHeight: '1.5' }}>{clinicalData.soap_notes}</div>
                  <h3 style={{ fontSize: '1rem', color: '#64748b', marginTop: '1.5rem' }}>Raw Translated Transcript</h3>
                  <p style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>"{transcription}"</p>
                </>
              ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Speak in Kannada or English to generate notes.</div>}
            </div>
          </div>
          
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Clinical Decision Support (CDSS)</h2>
            <div style={styles.scrollArea}>
              
              {clinicalData ? (
                <>
                  <h3 style={{ fontSize: '1rem', color: '#334155', marginTop: 0 }}>Suggested Lab Tests</h3>
                  {clinicalData.suggested_tests.map((test, idx) => (
                    <div key={idx} style={{...styles.checkItem, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', margin: 0 }}>
                        <input type="checkbox" checked={selectedTests.includes(test.name)} onChange={() => toggleTest(test.name)} style={{ width: '18px', height: '18px' }}/>
                        <span style={{ fontWeight: '500' }}>{test.name}</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={styles.costBadge}>{test.cost_estimate}</span>
                        <button onClick={() => removeTest(test.name)} style={styles.deleteBtn} title="Remove Test">🗑️</button>
                      </div>
                    </div>
                  ))}
                  <input type="text" placeholder="+ Type custom test & press Enter..." value={customTest} onChange={(e) => setCustomTest(e.target.value)} onKeyDown={handleAddCustomTest} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px dashed #cbd5e1', marginTop: '0.5rem', boxSizing: 'border-box' }} />

                  <h3 style={{ fontSize: '1rem', color: '#334155', marginTop: '1.5rem' }}>Prescriptions & Dosage</h3>
                  {clinicalData.suggested_medicines.map((med, idx) => (
                    <div key={idx} style={styles.checkItem}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', margin: 0 }}>
                          <input type="checkbox" checked={selectedMeds.includes(med.name)} onChange={() => toggleMed(med.name)} style={{ width: '18px', height: '18px' }}/>
                          <span style={{ fontWeight: '500' }}>{med.name}</span>
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={styles.costBadge}>{med.cost_estimate}</span>
                          <button onClick={() => removeMed(med.name)} style={styles.deleteBtn} title="Remove Medication">🗑️</button>
                        </div>
                      </div>

                      {selectedMeds.includes(med.name) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
                          <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                            <strong>Timing:</strong>
                            <label style={{cursor: 'pointer'}}><input type="checkbox" checked={med.morning || false} onChange={(e) => updateMedDetails(idx, 'morning', e.target.checked)}/> Mor</label>
                            <label style={{cursor: 'pointer'}}><input type="checkbox" checked={med.afternoon || false} onChange={(e) => updateMedDetails(idx, 'afternoon', e.target.checked)}/> Aft</label>
                            <label style={{cursor: 'pointer'}}><input type="checkbox" checked={med.night || false} onChange={(e) => updateMedDetails(idx, 'night', e.target.checked)}/> Nig</label>
                          </div>
                          <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                            <select value={med.food || 'After Food'} onChange={(e) => updateMedDetails(idx, 'food', e.target.value)} style={{padding: '0.2rem', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none'}}>
                              <option>After Food</option>
                              <option>Before Food</option>
                            </select>
                          </div>
                          <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1}}>
                            <input type="text" value={med.duration || ''} onChange={(e) => updateMedDetails(idx, 'duration', e.target.value)} placeholder="e.g. 15 tabs or 5 days" style={{padding: '0.3rem', borderRadius: '4px', border: '1px solid #cbd5e1', width: '100%', outline: 'none'}} />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <input type="text" placeholder="+ Type custom med & press Enter..." value={customMed} onChange={(e) => setCustomMed(e.target.value)} onKeyDown={handleAddCustomMed} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px dashed #cbd5e1', marginTop: '0.5rem', boxSizing: 'border-box' }} />

                  {isPredictingCost && <p style={{ color: '#0284c7', fontSize: '0.9rem', textAlign: 'center', marginTop: '1rem' }}>Predicting real-time cost...</p>}

                  <button onClick={handleFinalize} style={{...styles.button, backgroundColor: '#16a34a', marginTop: '2rem'}}>✓ Finalize Prescription & Discharge</button>
                </>
              ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Awaiting AI clinical analysis.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App;