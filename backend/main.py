from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
import os
from dotenv import load_dotenv
import pandas as pd
import altair as alt
import json
from fastapi.responses import JSONResponse  # Import JSONResponse

# python -m uvicorn backend.main:app --reload

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Global DataFrame variable to store the uploaded dataset
global_df = pd.DataFrame()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this to restrict allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure OpenAI API key
client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY")
)

# Define request and response models
class QueryRequest(BaseModel):
    prompt: str

class QueryResponse(BaseModel):
    response: str

class Spec(BaseModel):
  spec: str


def text_response(prompt):
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Error querying OpenAI: {e}"

def generate_chart(query, df):
  prompt = f'''
    Dataset overview (top five rows): {df.head().to_markdown()}

    Given the dataset above, generate a vega-lite specification for the user query, limit width to 400. The data field will be inserted dynamically, so leave it empty: {query}.

  '''
  response = client.beta.chat.completions.parse(
    model="gpt-4o-mini",
    messages=[
      {"role": "user", "content": prompt}
    ],
    response_format=Spec
  )
  return response.choices[0].message.parsed.spec

def get_feedback(query, df, spec):
  prompt = f'''
    Dataset overview (top five rows): {df.head().to_markdown()}

    User query: {query}.

    Generated Vega-lite spec: {spec}

    Please provide feedback on the generated chart whether the spec is valid in syntax and faithful to the user query.
  '''
  response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
      {"role": "user", "content": prompt}
    ]
  )
  feedback = response.choices[0].message.content
  return feedback

def improve_response(query, df, spec, feedback):
    prompt = f'''
      Dataset overview (top five rows): {df.head().to_markdown()}

      User query: {query}.

      Generated Vega-lite spec: {spec}

      Feedback: {feedback}

      Improve the vega-lite spec with the feedback if only necessary. Otherwise, return the original spec.

    '''
    response = client.beta.chat.completions.parse(
    model="gpt-4o-mini",
    messages=[
      {"role": "user", "content": prompt}
    ],
      response_format=Spec
    )
    return response.choices[0].message.parsed.spec



# Endpoint to interact with OpenAI API and generate the chart
# Endpoint to interact with OpenAI API and generate the chart
@app.post("/query", response_model=QueryResponse)
async def query_openai(request: QueryRequest):
    global global_df  # Access the global DataFrame

    if global_df.empty:
        return QueryResponse(response="No dataset uploaded yet.")

    # Create a prompt using the dataset
    columns = global_df.columns.tolist()
    prompt = f"Is the following prompt relevant and answerable based on data with these columns {columns}? Any question that mentions the columns is answerable.\n\nRespond with just 'yes' or 'no'.\n\nHere is the prompt: {request.prompt}"

    try:
        # Initial query to check relevance
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        response_text = response.choices[0].message.content.strip()

        if 'yes' in response_text.lower():  # Adjust based on actual check logic
            reduced_df = global_df.head()

            # Attempt to generate the chart, allowing for one retry
            for attempt in range(2):  # Try twice
                try:
                    spec = generate_chart(request.prompt, reduced_df)

                    feedback = get_feedback(request.prompt, reduced_df, spec)

                    final_spec = improve_response(request.prompt, reduced_df, spec, feedback)
                    final_spec_parsed = json.loads(final_spec)

                    data_records = global_df.to_dict(orient='records')
                    final_spec_parsed['data'] = {'values': data_records}

                    # Brief description of the Vega chart
                    prompt = f"Provide a short, 2 sentence description of the following vega chart: \n\n {final_spec}"
                    response = client.chat.completions.create(
                        model="gpt-3.5-turbo",
                        messages=[{"role": "user", "content": prompt}]
                    )
                    response_text = response.choices[0].message.content.strip()

                    # Convert the Altair chart to a dictionary (Vega-Lite spec)
                    chart = alt.Chart.from_dict(final_spec_parsed)
                    chart_json = chart.to_json()  # Convert to JSON format

                    # Return the chart JSON to the frontend
                    return JSONResponse(content={"chart": json.loads(chart_json), "response": response_text})

                except Exception as e:
                    # Log the error and retry if it's not the last attempt
                    print(f"Graph generation error, trying again...")
                    if attempt == 1:  # If this was the last attempt
                        return QueryResponse(response="Error: graph failed to load after two attempts, please try again.")

        else:
            return QueryResponse(response=f"The question \"{request.prompt}\" is not relevant to the dataset.")

    except Exception as e:
        return QueryResponse(response=f"Error querying OpenAI: {e}")




# Endpoint to handle file uploads
@app.post("/uploadfile/")
async def upload_file(file: UploadFile = File(...)):
    global global_df  # Access the global DataFrame
    try:
        # Read the uploaded file as a pandas DataFrame
        global_df = pd.read_csv(file.file)

        # Get the title of the first column
        first_column_title = global_df.columns[0]

        # Print "file received" and the first column title
        print(f"File received. First column title: {first_column_title}")

        # Return a response with a message and the first column title
        return {"message": f"File received, first_column_title: {first_column_title}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing file: {e}")

# Serve React static files
app.mount("/", StaticFiles(directory="client/build", html=True), name="static")

# Custom 404 handler for React routes
@app.get("/{path_name:path}")
async def serve_react(path_name: str):
    return FileResponse("client/build/index.html")
