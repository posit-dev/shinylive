/// <reference types="cypress" />

// Welcome to Cypress!
//
// This spec file contains a variety of sample tests
// for a todo list app that are designed to demonstrate
// the power of writing tests in Cypress.
//
// To learn more about how Cypress works and
// what makes it such an awesome testing tool,
// please read our getting started guide:
// https://on.cypress.io/introduction-to-cypress

describe("Editor interface", () => {
  it("Add a new file and run a line from it in console", () => {
    cy.visit("http://localhost:3000/examples/");

    // Wait for initialization to complete
    cy.contains(">>>", { timeout: 10000 });

    cy.get(`[aria-label="Add a file"]`).click();
    cy.contains("file1").type("{selectAll}newFile.py{enter}");

    cy.get(".cm-editor").type(`print("hello world")`).type("{command+enter}");
  });
});
