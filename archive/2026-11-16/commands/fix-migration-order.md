# Fix Migration Order Command

You are tasked with fixing Atlas migration "out of order" errors by removing a problematic migration file and regenerating it with the correct timestamp. Follow these steps exactly:

## Step 1: Validate Arguments
Ensure the migration filename is provided as an argument. The filename should be in the format `YYYYMMDDHHMMSS_description.sql`.

If no filename is provided, show usage:
```
Usage: fix-migration-order <migration_filename>
Example: fix-migration-order 20251003024132_fix_database_overview_setting.sql
```

## Step 2: Verify File Exists
Check if the migration file exists in `database/migrations/` directory:
```bash
ls database/migrations/ | grep <migration_filename>
```

If the file doesn't exist, inform the user and exit.

## Step 3: Extract Migration Name
Extract the descriptive part from the filename (everything after the timestamp and underscore):
```bash
# For 20251003024132_fix_database_overview_setting.sql
# Extract: fix_database_overview_setting
migration_name=$(echo "<migration_filename>" | sed 's/^[0-9]*_//' | sed 's/\.sql$//')
```

## Step 4: Execute Fix Process
Run the three-step fix process:

1. **Delete the problematic migration file:**
```bash
rm database/migrations/<migration_filename>
echo "✅ Deleted problematic migration file: <migration_filename>"
```

2. **Update checksums:**
```bash
task db:migrate:rehash
echo "✅ Updated migration checksums"
```

3. **Generate new migration file:**
```bash
task db:migrate:generate -- <migration_name>
echo "✅ Generated new migration file with correct timestamp"
```

## Step 5: Show Results
List the latest migration files to show the newly created file:
```bash
echo "📋 Latest migration files:"
ls database/migrations/ | tail -3
```

## Step 6: Provide Next Steps
Inform the user about next steps:
```
✨ Migration order fixed successfully!

Next steps:
1. Review the new migration file content
2. Test locally: task db:migrate:apply:local
3. Commit changes: jj commit -m "fix: resolve migration order for <migration_name>"
4. Create PR if needed

Note: The new migration file will have the current timestamp and should resolve the "out of order" error in CI/CD.
```

## Error Handling
- If any step fails, stop execution and show the error
- Provide helpful error messages with suggested solutions
- Ensure the user understands what went wrong and how to fix it

## Important Notes:
- This command should be run from the project root directory
- Ensure you have proper permissions to delete and create files
- The migration content will be regenerated based on current schema differences
- Always test the new migration locally before pushing to CI/CD