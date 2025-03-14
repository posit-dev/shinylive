library(shiny)
library(bslib)

# Define UI for dataset viewer app ----
ui <- page_sidebar(

  # App title ----
  title = "Reactivity",

  # Sidebar panel for inputs ----
  sidebar = sidebar(

    # Input: Text for providing a caption ----
    # Note: Changes made to the caption in the textInput control
    # are updated in the output area immediately as you type
    textInput(
      inputId = "caption_text",
      label = "Caption:",
      value = "Data Summary"
    ),

    # Input: Selector for choosing dataset ----
    selectInput(
      inputId = "dataset",
      label = "Choose a dataset:",
      choices = c("rock", "pressure", "cars")
    ),

    # Input: Numeric entry for number of obs to view ----
    numericInput(
      inputId = "obs",
      label = "Number of observations to view:",
      value = 10
    )
  ),

  # Output: Formatted text for caption ----
  h3(textOutput("caption", container = span)),

  # Output: Verbatim text for data summary ----
  verbatimTextOutput("summary"),

  # Output: HTML table with requested number of observations ----
  tableOutput("view")
)

# Define server logic to summarize and view selected dataset ----
server <- function(input, output) {

  # Return the requested dataset ----
  # By declaring datasetInput as a reactive expression we ensure
  # that:
  #
  # 1. It is only called when the inputs it depends on changes
  # 2. The computation and result are shared by all the callers,
  #    i.e. it only executes a single time
  datasetInput <- reactive({
    switch(
      input$dataset,
      "rock" = rock,
      "pressure" = pressure,
      "cars" = cars
    )
  })

  # Create caption ----
  # The output$caption is computed based on a reactive expression
  # that returns input$caption. When the user changes the
  # "caption" field:
  #
  # 1. This function is automatically called to recompute the output
  # 2. New caption is pushed back to the browser for re-display
  #
  # Note that because the data-oriented reactive expressions
  # below don't depend on input$caption_text, those expressions are
  # NOT called when input$caption_text changes
  output$caption <- renderText({
    input$caption_text
  })

  # Generate a summary of the dataset ----
  # The output$summary depends on the datasetInput reactive
  # expression, so will be re-executed whenever datasetInput is
  # invalidated, i.e. whenever the input$dataset changes
  output$summary <- renderPrint({
    dataset <- datasetInput()
    summary(dataset)
  })

  # Show the first "n" observations ----
  # The output$view depends on both the databaseInput reactive
  # expression and input$obs, so it will be re-executed whenever
  # input$dataset or input$obs is changed
  output$view <- renderTable({
    head(datasetInput(), n = input$obs)
  })
}

# Create Shiny app ----
shinyApp(ui, server)
