//! Persistence tests against a real on-disk SQLite file: data written in one
//! "session" must be there after the database is closed and reopened (app restart).

use findmyrefs_lib::db::{self, repo};
use findmyrefs_lib::models::*;

fn new_reference(project_id: &str, id: &str) -> NewReference {
    NewReference {
        project_id: project_id.into(),
        provider: "mock".into(),
        provider_result_id: id.into(),
        title: format!("Demo result {id}"),
        thumbnail_url: Some("data:image/svg+xml;utf8,<svg/>".into()),
        source_url: format!("https://example.com/demo/{id}"),
        creator_name: Some("Demo creator".into()),
        width: Some(800),
        height: Some(600),
        license_label: Some("Demo".into()),
        category: Some("subject".into()),
        is_demo: true,
    }
}

#[test]
fn project_board_and_notes_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join("findmyrefs.sqlite");

    let (project_id, item_id, reference_id) = {
        let conn = db::open(&path).unwrap();
        let project = repo::create_project(&conn, "Winter fox").unwrap();
        repo::update_project(
            &conn,
            &project.id,
            &ProjectPatch {
                original_prompt: Some("A red fox in deep snow at dawn".into()),
                structured_brief_json: Some(Some(r#"{"originalPrompt":"A red fox"}"#.into())),
                ..Default::default()
            },
        )
        .unwrap();
        let reference = repo::save_reference(&conn, &new_reference(&project.id, "r1")).unwrap();
        repo::update_reference_notes(&conn, &reference.id, "Use this fur texture").unwrap();
        let item = repo::add_board_item(
            &conn,
            &NewBoardItem {
                project_id: project.id.clone(),
                reference_id: reference.id.clone(),
                group_name: "subject".into(),
                position_x: 10.0,
                position_y: 20.0,
                width: 220.0,
                height: 260.0,
            },
        )
        .unwrap();
        repo::update_board_item(
            &conn,
            &item.id,
            &BoardItemPatch {
                position_x: Some(345.5),
                position_y: Some(678.25),
                ..Default::default()
            },
        )
        .unwrap();
        (project.id, item.id, reference.id)
        // connection dropped here = app closed
    };

    let conn = db::open(&path).unwrap();
    assert_eq!(db::schema_version(&conn).unwrap(), db::latest_version());
    let project = repo::get_project(&conn, &project_id).unwrap().unwrap();
    assert_eq!(project.name, "Winter fox");
    assert_eq!(project.original_prompt, "A red fox in deep snow at dawn");
    assert!(project.structured_brief_json.unwrap().contains("A red fox"));

    let items = repo::list_board_items(&conn, &project_id).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, item_id);
    assert_eq!(items[0].position_x, 345.5);
    assert_eq!(items[0].position_y, 678.25);
    assert_eq!(items[0].group_name, "subject");

    let reference = repo::get_reference(&conn, &reference_id).unwrap().unwrap();
    assert_eq!(reference.user_notes, "Use this fur texture");
    assert!(reference.is_demo);
}

#[test]
fn saving_the_same_result_twice_is_idempotent() {
    let conn = db::open_in_memory().unwrap();
    let project = repo::create_project(&conn, "P").unwrap();
    let a = repo::save_reference(&conn, &new_reference(&project.id, "same")).unwrap();
    repo::update_reference_notes(&conn, &a.id, "keep me").unwrap();
    let b = repo::save_reference(&conn, &new_reference(&project.id, "same")).unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(b.user_notes, "keep me");
    assert_eq!(repo::list_references(&conn, &project.id).unwrap().len(), 1);
}

#[test]
fn reference_appears_once_per_board() {
    let conn = db::open_in_memory().unwrap();
    let project = repo::create_project(&conn, "P").unwrap();
    let r = repo::save_reference(&conn, &new_reference(&project.id, "x")).unwrap();
    let input = NewBoardItem {
        project_id: project.id.clone(),
        reference_id: r.id.clone(),
        group_name: String::new(),
        position_x: 0.0,
        position_y: 0.0,
        width: 200.0,
        height: 200.0,
    };
    let first = repo::add_board_item(&conn, &input).unwrap();
    let second = repo::add_board_item(&conn, &input).unwrap();
    assert_eq!(first.id, second.id);
}

#[test]
fn deleting_a_project_removes_all_its_data() {
    let conn = db::open_in_memory().unwrap();
    let project = repo::create_project(&conn, "Delete me").unwrap();
    let r = repo::save_reference(&conn, &new_reference(&project.id, "x")).unwrap();
    repo::add_board_item(
        &conn,
        &NewBoardItem {
            project_id: project.id.clone(),
            reference_id: r.id.clone(),
            group_name: String::new(),
            position_x: 0.0,
            position_y: 0.0,
            width: 200.0,
            height: 200.0,
        },
    )
    .unwrap();
    repo::hide_result(&conn, &project.id, "mock:1").unwrap();
    repo::insert_search_session(
        &conn,
        &NewSearchSession {
            project_id: project.id.clone(),
            query: "fox".into(),
            provider: "mock".into(),
            category: None,
            result_count: Some(3),
        },
    )
    .unwrap();

    repo::delete_project(&conn, &project.id).unwrap();
    for table in [
        "saved_references",
        "board_items",
        "hidden_results",
        "search_sessions",
    ] {
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "{table} should be empty");
    }
}

#[test]
fn deleting_a_reference_removes_its_board_item() {
    let conn = db::open_in_memory().unwrap();
    let project = repo::create_project(&conn, "P").unwrap();
    let r = repo::save_reference(&conn, &new_reference(&project.id, "x")).unwrap();
    repo::add_board_item(
        &conn,
        &NewBoardItem {
            project_id: project.id.clone(),
            reference_id: r.id.clone(),
            group_name: String::new(),
            position_x: 0.0,
            position_y: 0.0,
            width: 200.0,
            height: 200.0,
        },
    )
    .unwrap();
    repo::delete_reference(&conn, &r.id).unwrap();
    assert!(
        repo::list_board_items(&conn, &project.id)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn rejects_invalid_input() {
    let conn = db::open_in_memory().unwrap();
    assert!(repo::create_project(&conn, "   ").is_err());
    let project = repo::create_project(&conn, "P").unwrap();
    let mut bad = new_reference(&project.id, "x");
    bad.source_url = "javascript:alert(1)".into();
    assert!(repo::save_reference(&conn, &bad).is_err());
    let r = repo::save_reference(&conn, &new_reference(&project.id, "ok")).unwrap();
    let item = repo::add_board_item(
        &conn,
        &NewBoardItem {
            project_id: project.id.clone(),
            reference_id: r.id,
            group_name: String::new(),
            position_x: 0.0,
            position_y: 0.0,
            width: 200.0,
            height: 200.0,
        },
    )
    .unwrap();
    let nan = BoardItemPatch {
        position_x: Some(f64::NAN),
        ..Default::default()
    };
    assert!(repo::update_board_item(&conn, &item.id, &nan).is_err());
    assert!(
        repo::update_project(
            &conn,
            &project.id,
            &ProjectPatch {
                structured_brief_json: Some(Some("{not json".into())),
                ..Default::default()
            }
        )
        .is_err()
    );
}

#[test]
fn month_usage_sums_known_costs_and_counts_unknown() {
    let conn = db::open_in_memory().unwrap();
    let month = repo::current_month();
    for cost in [Some(0.5), None, Some(0.25)] {
        repo::insert_usage(
            &conn,
            &UsageRecord {
                id: repo::new_usage_id(),
                created_at: repo::now(),
                provider: "anthropic".into(),
                model: "claude-opus-5-5".into(),
                feature: "brief_analysis".into(),
                image_count: 0,
                input_tokens: None,
                output_tokens: None,
                estimated_cost_usd: cost,
                status: "ok".into(),
                error_code: None,
            },
        )
        .unwrap();
    }
    let usage = repo::month_usage(&conn, &month).unwrap();
    assert_eq!(usage.requests, 3);
    assert!((usage.estimated_cost_usd - 0.75).abs() < 1e-9);
    assert_eq!(usage.requests_without_cost, 1);
    repo::clear_usage(&conn).unwrap();
    assert_eq!(repo::month_usage(&conn, &month).unwrap().requests, 0);
}
