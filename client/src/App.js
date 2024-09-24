import { useState, useEffect, useRef } from 'react';
import './App.css';
import userAvatar from './images/user-avatar.jpg';
import botAvatar from './images/bot-avatar.jpg';
import * as d3 from 'd3-dsv'; // Import d3-dsv for CSV parsing
import { VegaLite } from 'react-vega'; // Import Vega-Lite component

const url = process.env.NODE_ENV === 'production' ? 'https://sutulas.github.io/HAI-Assignment-2/' : 'http://127.0.0.1:8000/';

function App() {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState([{ type: "bot", text: "Upload a CSV file and then ask visualization questions" }]);
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [csvData, setCsvData] = useState(null); // State to hold parsed CSV data
  const [showPreview, setShowPreview] = useState(false); // State to toggle CSV preview

  const chatBoxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [response]);

  function sendMessage() {
    if (message === "") return;

    const newMessage = { type: "user", text: message };
    setResponse([...response, newMessage]);

    fetch(`${url}query`, {
      method: 'POST',
      body: JSON.stringify({ prompt: message }),
      headers: { 'Content-Type': 'application/json' },
    })
      .then(response => response.json())
      .then(data => {
        const botResponse = { type: "bot", text: data.response };

        // If the chart spec is included in the response, add it to the response array
        if (data.chart) {
          const botChartResponse = { type: "bot-chart", chartSpec: data.chart }; // Custom message type for charts
          setResponse([...response, newMessage, botChartResponse, botResponse]);
        } else {
          setResponse([...response, newMessage, botResponse]);
        }
      });

    setMessage("");
  }

  function handleMessage(e) {
    setMessage(e.target.value);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') sendMessage();
  }

  // Check if the uploaded file is a CSV
  function isCSV(file) {
    return file && file.type === 'text/csv';
  }

  function handleFileUpload(e) {
    const uploadedFile = e.target.files[0];
    
    if (!isCSV(uploadedFile)) {
      const botResponse = { type: "bot", text: "Error: Please upload a valid CSV file." };
      setResponse([...response, botResponse]);
      return;
    }

    setFile(uploadedFile);
    parseCSV(uploadedFile);
    sendFile(uploadedFile); // Automatically send file to backend after upload
  }

  function sendFile(uploadedFile) {
    if (uploadedFile) {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      fetch(`${url}uploadfile/`, {
        method: 'POST',
        body: formData,
      })
        .then(response => response.json())
        .catch(() => {
          const botResponse = { type: "bot", text: "Error processing file." };
          setResponse([...response, botResponse]);
        });
    }
  }

  // Parse CSV file and store data in state using d3-dsv
  function parseCSV(file) {
    const reader = new FileReader();

    reader.onload = function (e) {
      const text = e.target.result;
      const parsedData = d3.csvParse(text, d3.autoType); // Parse CSV and auto convert types
      setCsvData(parsedData.slice(0, 50)); // Store only the first 50 rows for preview
    };

    reader.readAsText(file);
  }

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFile = e.dataTransfer.files[0];

    // Check if dropped file is a CSV
    if (!isCSV(droppedFile)) {
      const botResponse = { type: "bot", text: "Error: Please upload a valid CSV file." };
      setResponse([...response, botResponse]);
      return;
    }

    setFile(droppedFile);
    parseCSV(droppedFile);
    sendFile(droppedFile); // Automatically send file to backend after drop
  };

  const handleClick = () => {
    inputRef.current.click();
  };

  // Function to handle CSV preview toggle
  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  return (
    <div className="chat-container">
      <h1 className="chat-title">AI Data Visualization Assistant</h1>

      <div
        className={`drag-and-drop-area ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <p>Drag and drop a CSV file here or click to upload</p>
        <input
          type="file"
          accept=".csv"
          ref={inputRef}
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
      </div>

      {file && (
        <div className="file-actions">
          <button onClick={togglePreview} className="preview-button">{showPreview ? 'Hide Preview' : 'Preview CSV'}</button>
        </div>
      )}

      {showPreview && csvData && (
        <div className="csv-preview">
          <table>
            <thead>
              <tr>
                {Object.keys(csvData[0] || {}).map((header, idx) => (
                  <th key={idx}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csvData.map((row, idx) => (
                <tr key={idx}>
                  {Object.values(row).map((val, idx) => (
                    <td key={idx}>{val}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="chat-box" ref={chatBoxRef}>
        {response.map((msg, index) => (
          <div key={index} className={`chat-message ${msg.type}`}>
            <img
              src={msg.type === "user" ? userAvatar : botAvatar}
              alt="avatar"
              className="avatar"
            />
            <div className="message-bubble">
              {msg.type === "bot-chart" ? (
                <div className="bot-chart-message">
                  <VegaLite spec={msg.chartSpec} /> {/* Render Vega-Lite chart for bot-chart messages */}
                </div>
              ) : (
                <span>{msg.text}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="input-container">
        <input
          type="text"
          placeholder="Type your message here"
          value={message}
          className="input-field"
          onInput={handleMessage}
          onKeyDown={handleKeyDown}
        />
        <button className="send-button" onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

export default App;
