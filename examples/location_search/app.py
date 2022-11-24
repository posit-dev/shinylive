from shiny import App, render, ui

app_ui = ui.page_fluid(
    ui.tags.script(
       """
        let searchObject = {};
        let search =  window.parent.location.search.substring(1);
        let searchArray = search.split('&');
        for(item of searchArray){
            let array = item.split("=");
            let key = array[0];
            let value = array[1];
            searchObject[key] = value;
        }
        
        $(document).on('shiny:connected', function(event) {
            Shiny.setInputValue("searchString", searchObject);
        }); 
       """
    ),
    ui.h2("Location Search"),
    ui.output_text_verbatim("search"),
)

def server(input, output, session):
    @output
    @render.text
    def search():
        return f"Location search is : {input.searchString()}"

app = App(app_ui, server)
