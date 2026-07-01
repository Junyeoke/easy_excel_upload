// ExcelUploadDataSourceProvider.java
package com.steg.lit.controller;

import org.springframework.stereotype.Component;

import javax.naming.Context;
import javax.naming.InitialContext;
import javax.sql.DataSource;

/**
 * Resolves the Excel upload DataSource from the application JNDI context.
 */
@Component
public class ExcelUploadDataSourceProvider {

    public DataSource getDataSource() throws Exception {
        Context ctx = new InitialContext();
        return (DataSource) ((Context) ctx.lookup("java:comp/env")).lookup("egene");
    }
}
